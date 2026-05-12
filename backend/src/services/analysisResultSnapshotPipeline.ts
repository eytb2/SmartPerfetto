// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import crypto from 'crypto';
import type { DataEnvelope } from '../types/dataContract';
import {
  ANALYSIS_RESULT_SNAPSHOT_SCHEMA_VERSION,
  STANDARD_COMPARISON_METRICS,
  type AnalysisResultSceneType,
  type AnalysisResultSnapshot,
  type EvidenceRef,
  type NormalizedMetricSource,
  type NormalizedMetricValue,
  type StandardComparisonMetricKey,
} from '../types/multiTraceComparison';
import { openEnterpriseDb } from './enterpriseDb';
import { createAnalysisResultSnapshotRepository } from './analysisResultSnapshotStore';

export interface CompletedAnalysisSnapshotInput {
  tenantId?: string;
  workspaceId?: string;
  userId?: string;
  traceId: string;
  sessionId: string;
  runId?: string;
  reportId?: string;
  query: string;
  traceLabel?: string;
  conclusion?: string;
  confidence?: number;
  partial?: boolean;
  terminationReason?: string;
  terminationMessage?: string;
  dataEnvelopes?: DataEnvelope[];
  createdAt?: number;
}

function inferSceneType(query: string, envelopes: DataEnvelope[] = []): AnalysisResultSceneType {
  const text = [
    query,
    ...envelopes.flatMap(env => [
      env.meta?.skillId,
      env.meta?.source,
      env.meta?.stepId,
      env.display?.title,
    ]),
  ].filter(Boolean).join(' ').toLowerCase();

  if (/(startup|launch|cold start|warm start|启动|冷启动|热启动)/i.test(text)) return 'startup';
  if (/(scroll|scrolling|fps|jank|frame|帧率|滑动|卡顿|掉帧)/i.test(text)) return 'scrolling';
  if (/(interaction|tap|click|input|响应|交互)/i.test(text)) return 'interaction';
  if (/(memory|rss|oom|内存)/i.test(text)) return 'memory';
  if (/(cpu|thread|core|freq|调度|线程)/i.test(text)) return 'cpu';
  return 'general';
}

function firstNonEmptyLine(text: string | undefined): string | undefined {
  return text
    ?.split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);
}

function evidenceRefsFromInput(input: CompletedAnalysisSnapshotInput): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  if (input.reportId) {
    refs.push({
      id: `report:${input.reportId}`,
      type: 'report',
      reportId: input.reportId,
      runId: input.runId,
      label: 'Agent HTML report',
      url: `/api/reports/${input.reportId}`,
    });
  }

  const seen = new Set<string>();
  for (const env of (input.dataEnvelopes || []).slice(0, 100)) {
    const source = env.meta?.source || env.meta?.skillId || 'data_envelope';
    const stepId = env.meta?.stepId || 'step';
    const id = `data:${source}:${stepId}:${env.meta?.timestamp || 0}`;
    if (seen.has(id)) continue;
    seen.add(id);
    refs.push({
      id,
      type: 'data_envelope',
      dataEnvelopeId: id,
      runId: input.runId,
      label: env.display?.title || source,
      metadata: {
        source,
        skillId: env.meta?.skillId,
        stepId: env.meta?.stepId,
        displayLayer: env.display?.layer,
        displayFormat: env.display?.format,
      },
    });
  }
  return refs;
}

function dataEnvelopeRefId(env: DataEnvelope): string {
  const source = env.meta?.source || env.meta?.skillId || 'data_envelope';
  const stepId = env.meta?.stepId || 'step';
  return `data:${source}:${stepId}:${env.meta?.timestamp || 0}`;
}

function payloadRows(env: DataEnvelope): Array<Record<string, unknown>> {
  const data = env.data as any;
  if (!data || typeof data !== 'object') return [];

  if (Array.isArray(data.rows)) {
    if (data.rows.length === 0) return [];
    if (data.rows.every((row: unknown) => row && typeof row === 'object' && !Array.isArray(row))) {
      return data.rows as Array<Record<string, unknown>>;
    }
    const columns: string[] = Array.isArray(data.columns)
      ? data.columns.filter((col: unknown): col is string => typeof col === 'string')
      : [];
    if (columns.length > 0) {
      return data.rows
        .filter((row: unknown): row is unknown[] => Array.isArray(row))
        .map((row: unknown[]) => {
          const out: Record<string, unknown> = {};
          columns.forEach((column, index) => {
            out[column] = row[index];
          });
          return out;
        });
    }
  }

  if (data.summary && typeof data.summary === 'object') {
    const metrics = (data.summary as any).metrics;
    if (Array.isArray(metrics)) {
      return metrics
        .filter((metric: unknown): metric is Record<string, unknown> => !!metric && typeof metric === 'object')
        .map(metric => ({
          label: metric.label,
          value: metric.value,
          unit: metric.unit,
        }));
    }
  }

  return [data as Record<string, unknown>];
}

function normalizeFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/,/g, '');
  if (!normalized) return null;
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function getRowNumber(row: Record<string, unknown>, candidates: string[]): number | null {
  const byNormalizedName = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    byNormalizedName.set(normalizeFieldName(key), value);
  }
  for (const candidate of candidates) {
    const value = byNormalizedName.get(normalizeFieldName(candidate));
    const parsed = toNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

const METRIC_FIELD_CANDIDATES: Record<StandardComparisonMetricKey, string[]> = {
  'startup.total_ms': ['startup.total_ms', 'startup_total_ms', 'total_ms', 'total_duration_ms', 'duration_ms', 'dur_ms', 'startup_ms'],
  'startup.first_frame_ms': ['startup.first_frame_ms', 'first_frame_ms', 'time_to_first_frame_ms', 'first_frame_duration_ms'],
  'startup.bind_application_ms': ['startup.bind_application_ms', 'bind_application_ms', 'bind_app_ms', 'bindApplicationMs'],
  'startup.activity_start_ms': ['startup.activity_start_ms', 'activity_start_ms', 'activityStartMs', 'activity_launch_ms'],
  'startup.main_thread_blocked_ms': ['startup.main_thread_blocked_ms', 'main_thread_blocked_ms', 'blocked_ms', 'mainThreadBlockedMs'],
  'scrolling.avg_fps': ['scrolling.avg_fps', 'avg_fps', 'average_fps', 'fps'],
  'scrolling.frame_count': ['scrolling.frame_count', 'frame_count', 'frames', 'total_frames'],
  'scrolling.jank_count': ['scrolling.jank_count', 'jank_count', 'janky_count', 'jank_frames', 'janky_frames'],
  'scrolling.jank_rate_pct': ['scrolling.jank_rate_pct', 'jank_rate_pct', 'jank_pct', 'jank_rate', 'janky_rate'],
  'scrolling.p50_frame_ms': ['scrolling.p50_frame_ms', 'p50_frame_ms', 'frame_p50_ms', 'p50_ms'],
  'scrolling.p95_frame_ms': ['scrolling.p95_frame_ms', 'p95_frame_ms', 'frame_p95_ms', 'p95_ms'],
  'scrolling.p99_frame_ms': ['scrolling.p99_frame_ms', 'p99_frame_ms', 'frame_p99_ms', 'p99_ms'],
  'cpu.main_thread_running_ms': ['cpu.main_thread_running_ms', 'main_thread_running_ms', 'running_ms'],
  'cpu.main_thread_runnable_ms': ['cpu.main_thread_runnable_ms', 'main_thread_runnable_ms', 'runnable_ms'],
  'cpu.big_core_pct': ['cpu.big_core_pct', 'big_core_pct', 'big_core_percent'],
  'cpu.avg_freq_mhz': ['cpu.avg_freq_mhz', 'avg_freq_mhz', 'average_freq_mhz'],
  'trace.duration_ms': ['trace.duration_ms', 'trace_duration_ms', 'duration_ms'],
  'trace.device_model': ['trace.device_model', 'device_model'],
  'trace.android_version': ['trace.android_version', 'android_version'],
  'trace.capture_config_summary': ['trace.capture_config_summary', 'capture_config_summary'],
};

function metricSourceFromEnvelope(env: DataEnvelope): NormalizedMetricSource {
  const type = env.meta?.type === 'sql_result' ? 'sql' : 'skill';
  return {
    type,
    ...(env.meta?.skillId ? { skillId: env.meta.skillId } : {}),
    ...(env.meta?.stepId ? { stepId: env.meta.stepId } : {}),
    dataEnvelopeId: dataEnvelopeRefId(env),
  };
}

function extractStandardMetrics(envelopes: DataEnvelope[] = []): NormalizedMetricValue[] {
  const byKey = new Map<string, NormalizedMetricValue>();
  for (const env of envelopes) {
    for (const row of payloadRows(env)) {
      for (const definition of STANDARD_COMPARISON_METRICS) {
        const value = getRowNumber(row, METRIC_FIELD_CANDIDATES[definition.key]);
        if (value === null) continue;
        const normalizedValue = definition.key === 'scrolling.jank_rate_pct' && value > 0 && value <= 1
          ? value * 100
          : value;
        if (byKey.has(definition.key)) continue;
        byKey.set(definition.key, {
          key: definition.key,
          label: definition.label,
          group: definition.group,
          value: normalizedValue,
          unit: definition.unit,
          direction: definition.direction,
          aggregation: definition.aggregation,
          confidence: 0.75,
          source: metricSourceFromEnvelope(env),
        });
      }
    }
  }
  return [...byKey.values()];
}

export function buildCompletedAnalysisResultSnapshot(
  input: CompletedAnalysisSnapshotInput,
): AnalysisResultSnapshot | null {
  if (!input.tenantId || !input.workspaceId || !input.runId) {
    return null;
  }

  const createdAt = input.createdAt ?? Date.now();
  const sceneType = inferSceneType(input.query, input.dataEnvelopes);
  const headline = firstNonEmptyLine(input.conclusion)
    || input.terminationMessage
    || 'Analysis completed';
  const metrics = extractStandardMetrics(input.dataEnvelopes);
  const partialReasons: string[] = [];
  if (input.partial) {
    partialReasons.push(input.terminationReason || input.terminationMessage || 'Analysis marked partial by runtime');
  }
  if (metrics.length === 0) {
    partialReasons.push('No normalized comparison metrics extracted yet');
  }

  return {
    id: `analysis-result-${crypto.randomUUID()}`,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    traceId: input.traceId,
    sessionId: input.sessionId,
    runId: input.runId,
    ...(input.reportId ? { reportId: input.reportId } : {}),
    ...(input.userId ? { createdBy: input.userId } : {}),
    visibility: 'private',
    sceneType,
    title: `${sceneType} analysis - ${input.traceLabel || input.traceId}`,
    userQuery: input.query,
    traceLabel: input.traceLabel || input.traceId,
    traceMetadata: {},
    summary: {
      headline,
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      ...(partialReasons.length > 0 ? { partialReasons } : {}),
    },
    metrics,
    evidenceRefs: evidenceRefsFromInput(input),
    status: input.partial || metrics.length === 0 ? 'partial' : 'ready',
    schemaVersion: ANALYSIS_RESULT_SNAPSHOT_SCHEMA_VERSION,
    createdAt,
  };
}

export function persistCompletedAnalysisResultSnapshot(
  input: CompletedAnalysisSnapshotInput,
): AnalysisResultSnapshot | null {
  const snapshot = buildCompletedAnalysisResultSnapshot(input);
  if (!snapshot) return null;

  const db = openEnterpriseDb();
  try {
    return createAnalysisResultSnapshotRepository(db).createSnapshot(snapshot);
  } finally {
    db.close();
  }
}
