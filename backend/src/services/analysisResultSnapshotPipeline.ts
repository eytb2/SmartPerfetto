// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import crypto from 'crypto';
import type { DataEnvelope } from '../types/dataContract';
import {
  ANALYSIS_RESULT_SNAPSHOT_SCHEMA_VERSION,
  type AnalysisResultSceneType,
  type AnalysisResultSnapshot,
  type EvidenceRef,
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
  const partialReasons: string[] = [];
  if (input.partial) {
    partialReasons.push(input.terminationReason || input.terminationMessage || 'Analysis marked partial by runtime');
  }
  partialReasons.push('No normalized comparison metrics extracted yet');

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
      partialReasons,
    },
    metrics: [],
    evidenceRefs: evidenceRefsFromInput(input),
    status: 'partial',
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
