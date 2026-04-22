// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type { AnalysisExecutor } from '../../agent/core/executors/analysisExecutor';
import {
  concludeDecision,
  type AnalysisServices,
  type ExecutionContext,
  type ExecutorResult,
  type ProgressEmitter,
} from '../../agent/core/orchestratorTypes';
import { resolveDrillDown } from '../../agent/core/drillDownResolver';
import type { FollowUpResolution } from '../../agent/core/followUpHandler';
import type { FrameEntity, SessionEntity } from '../../agent/context/entityStore';
import type { EnhancedSessionContext } from '../../agent/context/enhancedSessionContext';
import type { Finding } from '../../agent/types';

interface FrameComparisonRow {
  frame_id: string;
  jank_type: string;
  dur_ms?: number;
  vsync_missed?: number;
  process_name?: string;
  session_id?: string;
  start_ts?: string;
  end_ts?: string;
}

interface SessionComparisonRow {
  session_id: string;
  frame_count: number;
  jank_count: number;
  jank_rate: number;
  max_vsync_missed?: number;
  process_name?: string;
  start_ts?: string;
  end_ts?: string;
}

type ComparisonData =
  | { type: 'frame'; rows: FrameComparisonRow[] }
  | { type: 'session'; rows: SessionComparisonRow[] };

export class ComparisonExecutor implements AnalysisExecutor {
  constructor(
    private readonly sessionContext: EnhancedSessionContext,
    private readonly services: AnalysisServices,
    private readonly traceProcessorService?: any,
    private readonly traceId?: string
  ) {}

  async execute(ctx: ExecutionContext, emitter: ProgressEmitter): Promise<ExecutorResult> {
    const entities = ctx.intent.referencedEntities || [];

    if (entities.length < 2) {
      return this.insufficientEntitiesResult();
    }

    const entityTypes = new Set(entities.map(entity => entity.type));
    if (entityTypes.size !== 1) {
      return this.mixedEntityResult();
    }

    const entityType = entities[0].type === 'session' ? 'session' : 'frame';

    const followUp: FollowUpResolution = {
      isFollowUp: true,
      resolvedParams: {},
      confidence: 0.5,
    };

    const resolved = await resolveDrillDown(
      ctx.intent,
      followUp,
      this.sessionContext,
      this.traceProcessorService,
      this.traceId
    );

    if (!resolved || resolved.intervals.length < 2) {
      return this.resolutionFailedResult(entities.length);
    }

    const data = entityType === 'frame'
      ? this.buildFrameComparison(resolved.intervals)
      : this.buildSessionComparison(resolved.intervals);

    const narrative = await this.buildNarrative(ctx.query, data, emitter);
    const findings: Finding[] = [
      {
        id: `agentv2_compare_table_${Date.now()}`,
        category: 'comparison',
        type: 'comparison_table',
        severity: 'info',
        title: entityType === 'frame' ? '帧对比表' : '会话对比表',
        description: this.formatTable(data),
        source: 'agentv2.comparison',
        confidence: 0.88,
        details: {
          entityType,
          entityCount: resolved.intervals.length,
          data,
        },
      },
      {
        id: `agentv2_compare_narrative_${Date.now()}`,
        category: 'comparison',
        type: 'comparison_narrative',
        severity: this.determineSeverity(data),
        title: '对比分析',
        description: narrative,
        source: 'agentv2.comparison',
        confidence: 0.82,
      },
    ];

    emitter.emitUpdate('finding', { round: 1, findings });

    return {
      findings,
      lastStrategy: concludeDecision(0.85, 'AgentRuntime comparison completed'),
      confidence: 0.85,
      informationGaps: [],
      rounds: 1,
      stopReason: 'comparison_complete',
    };
  }

  private buildFrameComparison(intervals: Array<{ id: number | string; processName: string; startTs: string; endTs: string; metadata?: Record<string, unknown> }>): ComparisonData {
    const store = this.sessionContext.getEntityStore();
    const rows: FrameComparisonRow[] = intervals.map(interval => {
      const frameId = String(interval.metadata?.frame_id || interval.metadata?.frameId || interval.id);
      const cached = store.getFrame(frameId) as FrameEntity | null;
      const meta = interval.metadata || {};

      return {
        frame_id: frameId,
        jank_type: String(cached?.jank_type || meta.jank_type || meta.jankType || 'Unknown'),
        dur_ms: toNumber(cached?.dur_ms ?? meta.dur_ms ?? meta.durMs),
        vsync_missed: toNumber(cached?.vsync_missed ?? meta.vsync_missed ?? meta.vsyncMissed),
        process_name: String(cached?.process_name || interval.processName || ''),
        session_id: cached?.session_id || String(meta.session_id || meta.sessionId || ''),
        start_ts: String(cached?.start_ts || interval.startTs),
        end_ts: String(cached?.end_ts || interval.endTs),
      };
    });

    return { type: 'frame', rows };
  }

  private buildSessionComparison(intervals: Array<{ id: number | string; processName: string; startTs: string; endTs: string; metadata?: Record<string, unknown> }>): ComparisonData {
    const store = this.sessionContext.getEntityStore();
    const rows: SessionComparisonRow[] = intervals.map(interval => {
      const sessionId = String(interval.metadata?.session_id || interval.metadata?.sessionId || interval.id);
      const cached = store.getSession(sessionId) as SessionEntity | null;
      const meta = interval.metadata || {};

      const frameCount = toNumber(cached?.frame_count ?? meta.frame_count ?? meta.frameCount) || 0;
      const jankCount = toNumber(cached?.jank_count ?? meta.jank_count ?? meta.jankCount) || 0;
      const jankRate = frameCount > 0 ? (jankCount / frameCount) * 100 : 0;

      return {
        session_id: sessionId,
        frame_count: frameCount,
        jank_count: jankCount,
        jank_rate: jankRate,
        max_vsync_missed: toNumber(cached?.max_vsync_missed ?? meta.max_vsync_missed ?? meta.maxVsyncMissed),
        process_name: String(cached?.process_name || interval.processName || ''),
        start_ts: String(cached?.start_ts || interval.startTs),
        end_ts: String(cached?.end_ts || interval.endTs),
      };
    });

    return { type: 'session', rows };
  }

  private async buildNarrative(
    query: string,
    data: ComparisonData,
    emitter: ProgressEmitter
  ): Promise<string> {
    const prompt = [
      '你是 Android 性能分析助手。请对比以下数据并给出结论。',
      `用户问题: ${query}`,
      `实体类型: ${data.type}`,
      `数据: ${JSON.stringify(data.rows)}`,
      '输出要求: 先总结，再列关键差异，再给建议。',
    ].join('\n');

    try {
      const result = await this.services.modelRouter.callWithFallback(prompt, 'synthesis', {
        sessionId: this.sessionContext.getSessionId(),
        traceId: this.sessionContext.getTraceId(),
        promptId: 'agentv2.comparison',
        promptVersion: '1.0.0',
        contractVersion: 'comparison_text@1.0.0',
      });
      if (result.success && result.response) {
        return result.response;
      }
    } catch (error: unknown) {
      emitter.log(`[AgentV2Comparison] Narrative generation failed: ${String(error)}`);
    }

    return this.fallbackNarrative(data);
  }

  private fallbackNarrative(data: ComparisonData): string {
    if (data.type === 'frame') {
      const worst = [...data.rows].sort((a, b) => (b.dur_ms || 0) - (a.dur_ms || 0))[0];
      return `共对比 ${data.rows.length} 帧，最差帧为 ${worst.frame_id}（${(worst.dur_ms || 0).toFixed(2)}ms）。建议优先定位该帧对应线程阻塞与调度延迟。`;
    }

    const worst = [...data.rows].sort((a, b) => b.jank_rate - a.jank_rate)[0];
    const best = [...data.rows].sort((a, b) => a.jank_rate - b.jank_rate)[0];
    return `共对比 ${data.rows.length} 个会话，最差会话 ${worst.session_id}（${worst.jank_rate.toFixed(1)}%），最佳会话 ${best.session_id}（${best.jank_rate.toFixed(1)}%）。建议聚焦高卡顿会话中的关键帧链路。`;
  }

  private formatTable(data: ComparisonData): string {
    if (data.type === 'frame') {
      const lines = ['| 帧ID | 类型 | 耗时(ms) | 丢失VSync |', '|---|---|---:|---:|'];
      for (const row of data.rows) {
        lines.push(`| ${row.frame_id} | ${row.jank_type} | ${(row.dur_ms || 0).toFixed(2)} | ${row.vsync_missed || 0} |`);
      }
      return lines.join('\n');
    }

    const lines = ['| 会话ID | 总帧 | 卡顿帧 | 卡顿率 |', '|---|---:|---:|---:|'];
    for (const row of data.rows) {
      lines.push(`| ${row.session_id} | ${row.frame_count} | ${row.jank_count} | ${row.jank_rate.toFixed(1)}% |`);
    }
    return lines.join('\n');
  }

  private determineSeverity(data: ComparisonData): 'critical' | 'warning' | 'info' {
    if (data.type === 'session') {
      const maxRate = Math.max(...data.rows.map(row => row.jank_rate));
      if (maxRate > 10) return 'critical';
      if (maxRate > 5) return 'warning';
      return 'info';
    }

    const hasLongFrame = data.rows.some(row => (row.dur_ms || 0) > 32);
    return hasLongFrame ? 'warning' : 'info';
  }

  private insufficientEntitiesResult(): ExecutorResult {
    return {
      findings: [
        {
          id: `agentv2_compare_error_${Date.now()}`,
          category: 'error',
          type: 'comparison_error',
          severity: 'warning',
          title: '比较需要至少两个实体',
          description: '请至少提供两个帧或会话进行比较。',
          source: 'agentv2.comparison',
          confidence: 1,
        },
      ],
      lastStrategy: concludeDecision(0.4, 'insufficient_entities'),
      confidence: 0.4,
      informationGaps: ['需要至少两个实体'],
      rounds: 1,
      stopReason: 'insufficient_entities',
    };
  }

  private mixedEntityResult(): ExecutorResult {
    return {
      findings: [
        {
          id: `agentv2_compare_error_${Date.now()}`,
          category: 'error',
          type: 'comparison_error',
          severity: 'warning',
          title: '不支持混合类型比较',
          description: '请比较同类型实体（帧对帧，或会话对会话）。',
          source: 'agentv2.comparison',
          confidence: 1,
        },
      ],
      lastStrategy: concludeDecision(0.4, 'mixed_entity_types'),
      confidence: 0.4,
      informationGaps: ['混合类型不可比较'],
      rounds: 1,
      stopReason: 'mixed_entity_types',
    };
  }

  private resolutionFailedResult(requestedCount: number): ExecutorResult {
    return {
      findings: [
        {
          id: `agentv2_compare_error_${Date.now()}`,
          category: 'error',
          type: 'comparison_error',
          severity: 'warning',
          title: '实体解析失败',
          description: `无法解析 ${requestedCount} 个比较实体，请先运行一次完整分析。`,
          source: 'agentv2.comparison',
          confidence: 1,
        },
      ],
      lastStrategy: concludeDecision(0.3, 'resolution_failed'),
      confidence: 0.3,
      informationGaps: ['实体缓存不足'],
      rounds: 1,
      stopReason: 'resolution_failed',
    };
  }
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}
