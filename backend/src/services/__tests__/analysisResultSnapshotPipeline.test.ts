// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type { DataEnvelope } from '../../types/dataContract';
import { buildCompletedAnalysisResultSnapshot } from '../analysisResultSnapshotPipeline';

function envelope(): DataEnvelope {
  return {
    meta: {
      type: 'skill_result',
      version: '2.0.0',
      source: 'startup_analysis',
      skillId: 'startup_analysis',
      stepId: 'summary',
      timestamp: 123,
    },
    data: { rows: [] },
    display: {
      layer: 'overview',
      format: 'table',
      title: 'Startup summary',
    },
  };
}

describe('analysis result snapshot pipeline', () => {
  test('builds a partial snapshot from completed run metadata', () => {
    const snapshot = buildCompletedAnalysisResultSnapshot({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      traceId: 'trace-a',
      sessionId: 'session-a',
      runId: 'run-a',
      reportId: 'report-a',
      query: '分析启动速度',
      conclusion: '启动耗时偏高。\n需要继续看主线程。',
      confidence: 0.7,
      dataEnvelopes: [envelope()],
      createdAt: 1234,
    });

    expect(snapshot).toEqual(expect.objectContaining({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      traceId: 'trace-a',
      sessionId: 'session-a',
      runId: 'run-a',
      reportId: 'report-a',
      createdBy: 'user-a',
      sceneType: 'startup',
      visibility: 'private',
      status: 'partial',
      createdAt: 1234,
    }));
    expect(snapshot?.summary).toEqual(expect.objectContaining({
      headline: '启动耗时偏高。',
      confidence: 0.7,
      partialReasons: expect.arrayContaining(['No normalized comparison metrics extracted yet']),
    }));
    expect(snapshot?.metrics).toEqual([]);
    expect(snapshot?.evidenceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'report:report-a', type: 'report' }),
      expect.objectContaining({ type: 'data_envelope', label: 'Startup summary' }),
    ]));
  });

  test('returns null when tenant, workspace, or run metadata is missing', () => {
    expect(buildCompletedAnalysisResultSnapshot({
      traceId: 'trace-a',
      sessionId: 'session-a',
      query: 'analyze',
    })).toBeNull();
  });
});
