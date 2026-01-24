/**
 * Scrolling/Jank Analysis Strategy
 *
 * A 3-stage deterministic pipeline for analyzing scrolling performance issues:
 * 1. Overview: Locate jank intervals and jank frames (FPS, drop rate, frame list)
 * 2. Interval Metrics: CPU/GC/Binder analysis within problematic intervals
 * 3. Frame Details: Per-jank-frame deep dive for the most severe frames
 *
 * This strategy is triggered by queries mentioning scrolling, jank, frame drops,
 * stutter, FPS, or related Chinese terms.
 */

import { AgentResponse } from '../types/agentProtocol';
import {
  StagedAnalysisStrategy,
  StageDefinition,
  FocusInterval,
  IntervalHelpers,
} from './types';

// =============================================================================
// Defaults & Internal Types
// =============================================================================

const SCROLLING_DEFAULTS = {
  maxFocusSessions: 2,
  maxFramesPerSession: 8,
} as const;

interface RawInterval {
  sessionId: number;
  processName: string;
  startTs: string;
  endTs: string;
  jankFrameCount: number;
  maxVsyncMissed: number;
}

function toFiniteNumber(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// =============================================================================
// Trigger
// =============================================================================

function isScrollingOrJankQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes('滑动') ||
    q.includes('scroll') ||
    q.includes('jank') ||
    q.includes('掉帧') ||
    q.includes('丢帧') ||
    q.includes('卡顿') ||
    q.includes('stutter') ||
    q.includes('fps')
  );
}

// =============================================================================
// Interval Extraction
// =============================================================================

/**
 * Extract focus intervals from overview stage responses.
 * Parses scroll_sessions and get_app_jank_frames data to identify
 * the most problematic scrolling intervals.
 */
function extractScrollingIntervals(
  responses: AgentResponse[],
  helpers: IntervalHelpers
): FocusInterval[] {
  const frameResponses = responses.filter(
    r => r.agentId === 'frame_agent' && r.toolResults && r.toolResults.length > 0
  );

  const scrollSessions: Array<Record<string, any>> = [];
  const jankFrames: Array<Record<string, any>> = [];

  for (const resp of frameResponses) {
    for (const toolResult of resp.toolResults || []) {
      const data = toolResult.data as any;
      if (!data || typeof data !== 'object') continue;

      if (data.scroll_sessions) {
        scrollSessions.push(...helpers.payloadToObjectRows(data.scroll_sessions));
      }
      if (data.get_app_jank_frames) {
        jankFrames.push(...helpers.payloadToObjectRows(data.get_app_jank_frames));
      }
    }
  }

  if (scrollSessions.length === 0 || jankFrames.length === 0) return [];

  // Index sessions by (process_name, session_id)
  const sessionByKey = new Map<string, Record<string, any>>();
  for (const s of scrollSessions) {
    const processName = String(s.process_name ?? '');
    const sessionId = String(s.session_id ?? '');
    if (!processName || !sessionId) continue;
    sessionByKey.set(`${processName}#${sessionId}`, s);
  }

  // Group jank frames by (process_name, session_id)
  const framesByKey = new Map<string, Array<Record<string, any>>>();
  for (const f of jankFrames) {
    const processName = String(f.process_name ?? '');
    const sessionId = String(f.session_id ?? '');
    if (!processName || !sessionId) continue;
    const key = `${processName}#${sessionId}`;
    const list = framesByKey.get(key) || [];
    list.push(f);
    framesByKey.set(key, list);
  }

  const rawIntervals: RawInterval[] = [];
  for (const [key, frames] of framesByKey.entries()) {
    const session = sessionByKey.get(key);
    if (!session) continue;

    const processName = String(session.process_name ?? '');
    if (!helpers.isLikelyAppProcessName(processName)) continue;

    const sessionId = toFiniteNumber(session.session_id);
    const startTs = String(session.start_ts ?? '');
    const endTs = String(session.end_ts ?? '');
    if (!startTs || !endTs || startTs === '0' || endTs === '0') continue;

    // Use BigInt for safe comparison of large nanosecond timestamps
    try {
      if (BigInt(endTs) <= BigInt(startTs)) continue;
    } catch {
      continue;
    }

    let maxVsyncMissed = 0;
    for (const f of frames) {
      maxVsyncMissed = Math.max(maxVsyncMissed, toFiniteNumber(f.vsync_missed));
    }

    rawIntervals.push({
      sessionId,
      processName,
      startTs,
      endTs,
      jankFrameCount: frames.length,
      maxVsyncMissed,
    });
  }

  // Sort by severity: maxVsyncMissed > jankFrameCount > duration
  rawIntervals.sort((a, b) => {
    if (b.maxVsyncMissed !== a.maxVsyncMissed) return b.maxVsyncMissed - a.maxVsyncMissed;
    if (b.jankFrameCount !== a.jankFrameCount) return b.jankFrameCount - a.jankFrameCount;
    try {
      const durA = BigInt(a.endTs) - BigInt(a.startTs);
      const durB = BigInt(b.endTs) - BigInt(b.startTs);
      if (durB > durA) return 1;
      if (durB < durA) return -1;
    } catch { /* fallback: equal */ }
    return 0;
  });

  // Take top N and convert to FocusInterval
  return rawIntervals.slice(0, SCROLLING_DEFAULTS.maxFocusSessions).map((raw, index) => ({
    id: raw.sessionId,
    processName: raw.processName,
    startTs: raw.startTs,
    endTs: raw.endTs,
    priority: rawIntervals.length - index, // Higher priority for more severe
    label: `区间${raw.sessionId} · ${helpers.formatNsRangeLabel(raw.startTs, raw.endTs)}`,
    metadata: {
      jankFrameCount: raw.jankFrameCount,
      maxVsyncMissed: raw.maxVsyncMissed,
    },
  }));
}

// =============================================================================
// Stage Definitions
// =============================================================================

const overviewStage: StageDefinition = {
  name: 'overview',
  description: 'Locate jank intervals and jank frame distribution',
  progressMessageTemplate: '阶段 {{stageIndex}}/{{totalStages}}：先定位掉帧区间与掉帧点',
  tasks: [
    {
      agentId: 'frame_agent',
      domain: 'frame',
      scope: 'global',
      priority: 1,
      evidenceNeeded: ['scroll sessions', 'fps', 'jank frames', 'jank types distribution'],
      skillParams: { enable_frame_details: false },
      descriptionTemplate: '阶段 1/3：先定位滑动区间与掉帧分布（输出 FPS/掉帧率/掉帧列表；不要做逐帧详情）。',
    },
  ],
  extractIntervals: extractScrollingIntervals,
  shouldStop: (intervals) => {
    if (intervals.length === 0) {
      return { stop: true, reason: '未检测到可用于深入分析的掉帧区间' };
    }
    return { stop: false, reason: '' };
  },
};

const intervalMetricsStage: StageDefinition = {
  name: 'interval_metrics',
  description: 'CPU/GC/Binder analysis within problematic intervals',
  progressMessageTemplate: '阶段 {{stageIndex}}/{{totalStages}}：在掉帧区间内查看 CPU/GC/Binder',
  tasks: [
    {
      agentId: 'cpu_agent',
      domain: 'cpu',
      scope: 'per_interval',
      priority: 2,
      evidenceNeeded: ['cpu load', 'runqueue latency', 'cpu frequency', 'thread hotspots'],
      descriptionTemplate: '阶段 2/3：在 {{scopeLabel}} 内分析 CPU（调度/频率/热点线程）。',
    },
    {
      agentId: 'memory_agent',
      domain: 'memory',
      scope: 'per_interval',
      priority: 2,
      evidenceNeeded: ['heap usage', 'gc pauses', 'allocation spikes', 'lmk events'],
      descriptionTemplate: '阶段 2/3：在 {{scopeLabel}} 内分析内存/GC（是否存在频繁 GC、抖动、主线程 GC 暂停）。',
    },
    {
      agentId: 'binder_agent',
      domain: 'binder',
      scope: 'per_interval',
      priority: 3,
      evidenceNeeded: ['binder call latency', 'thread blocking', 'lock contention'],
      descriptionTemplate: '阶段 2/3：在 {{scopeLabel}} 内分析 Binder/锁竞争（慢调用、阻塞点）。',
    },
  ],
};

const frameDetailsStage: StageDefinition = {
  name: 'frame_details',
  description: 'Per-jank-frame deep dive for the most severe frames',
  progressMessageTemplate: '阶段 {{stageIndex}}/{{totalStages}}：对掉帧点做逐帧详情分析',
  tasks: [
    {
      agentId: 'frame_agent',
      domain: 'frame',
      scope: 'per_interval',
      priority: 1,
      evidenceNeeded: ['jank frame details', 'main thread vs render thread', 'jank responsibility'],
      focusTools: ['analyze_scrolling'],
      skillParams: {
        enable_frame_details: true,
        max_frames_per_session: SCROLLING_DEFAULTS.maxFramesPerSession,
      },
      descriptionTemplate: '阶段 3/3：在 {{scopeLabel}} 内对最严重的掉帧帧做逐帧详情分析（仅分析卡顿点）。',
    },
  ],
};

// =============================================================================
// Strategy Export
// =============================================================================

export const scrollingStrategy: StagedAnalysisStrategy = {
  id: 'scrolling',
  name: 'Scrolling/Jank Analysis',
  trigger: isScrollingOrJankQuery,
  stages: [overviewStage, intervalMetricsStage, frameDetailsStage],
  defaults: SCROLLING_DEFAULTS,
};
