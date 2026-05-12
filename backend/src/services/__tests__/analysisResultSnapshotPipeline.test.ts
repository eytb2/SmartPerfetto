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

  test('extracts startup metrics from structured DataEnvelope rows', () => {
    const snapshot = buildCompletedAnalysisResultSnapshot({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      traceId: 'trace-a',
      sessionId: 'session-a',
      runId: 'run-a',
      query: 'startup analysis',
      dataEnvelopes: [{
        ...envelope(),
        data: {
          columns: ['startup_id', 'total_ms', 'first_frame_ms'],
          rows: [[1, 1450.5, 620]],
        },
      }],
      createdAt: 1234,
    });

    expect(snapshot?.status).toBe('ready');
    expect(snapshot?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'startup.total_ms',
        value: 1450.5,
        unit: 'ms',
        source: expect.objectContaining({ skillId: 'startup_analysis' }),
      }),
      expect.objectContaining({
        key: 'startup.first_frame_ms',
        value: 620,
      }),
    ]));
    expect(snapshot?.summary.partialReasons).toBeUndefined();
  });

  test('extracts scrolling metrics and normalizes fractional jank rate to percent', () => {
    const snapshot = buildCompletedAnalysisResultSnapshot({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      traceId: 'trace-a',
      sessionId: 'session-a',
      runId: 'run-a',
      query: '对比 FPS 和 jank',
      dataEnvelopes: [{
        ...envelope(),
        meta: {
          ...envelope().meta,
          source: 'scrolling_analysis',
          skillId: 'scrolling_analysis',
          stepId: 'session_jank',
        },
        display: {
          ...envelope().display,
          title: 'Scrolling summary',
        },
        data: {
          rows: [{
            avg_fps: '58.5',
            frame_count: 240,
            jank_count: 12,
            jank_rate: 0.05,
            p95_frame_ms: 28,
          }],
        } as any,
      }],
      createdAt: 1234,
    });

    expect(snapshot?.sceneType).toBe('scrolling');
    expect(snapshot?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'scrolling.avg_fps', value: 58.5, unit: 'fps' }),
      expect.objectContaining({ key: 'scrolling.jank_rate_pct', value: 5, unit: '%' }),
      expect.objectContaining({ key: 'scrolling.p95_frame_ms', value: 28, unit: 'ms' }),
    ]));
  });
});
