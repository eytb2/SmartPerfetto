// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DataEnvelope } from '../../types/dataContract';
import {
  buildCompletedAnalysisResultSnapshot,
  persistCompletedAnalysisResultSnapshot,
} from '../analysisResultSnapshotPipeline';
import { ENTERPRISE_DB_PATH_ENV, openEnterpriseDb } from '../enterpriseDb';

const originalDbPath = process.env[ENTERPRISE_DB_PATH_ENV];
const tmpDirs: string[] = [];

function useTempEnterpriseDb(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartperfetto-snapshot-pipeline-'));
  tmpDirs.push(tmpDir);
  const dbPath = path.join(tmpDir, 'enterprise.sqlite');
  process.env[ENTERPRISE_DB_PATH_ENV] = dbPath;
  return dbPath;
}

afterEach(() => {
  if (originalDbPath === undefined) {
    delete process.env[ENTERPRISE_DB_PATH_ENV];
  } else {
    process.env[ENTERPRISE_DB_PATH_ENV] = originalDbPath;
  }
  while (tmpDirs.length > 0) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

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

  test('persists snapshot when the parent run graph does not exist yet', () => {
    useTempEnterpriseDb();

    const snapshot = persistCompletedAnalysisResultSnapshot({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      traceId: 'trace-a',
      sessionId: 'session-a',
      runId: 'run-a',
      query: '分析滑动性能',
      conclusion: '滑动整体稳定。',
      dataEnvelopes: [{
        ...envelope(),
        meta: {
          ...envelope().meta,
          source: 'scrolling_analysis',
          skillId: 'scrolling_analysis',
        },
        data: {
          rows: [{
            avg_fps: 60,
            jank_count: 0,
          }],
        } as any,
      }],
      createdAt: 1778937300000,
    });

    expect(snapshot).toEqual(expect.objectContaining({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      traceId: 'trace-a',
      sessionId: 'session-a',
      runId: 'run-a',
      status: 'ready',
    }));

    const db = openEnterpriseDb();
    try {
      const row = db.prepare(`
        SELECT s.id AS snapshot_id, r.id AS run_id, t.id AS trace_id
        FROM analysis_result_snapshots s
        JOIN analysis_runs r
          ON r.tenant_id = s.tenant_id
          AND r.workspace_id = s.workspace_id
          AND r.id = s.run_id
        JOIN trace_assets t
          ON t.tenant_id = s.tenant_id
          AND t.workspace_id = s.workspace_id
          AND t.id = s.trace_id
        WHERE s.id = ?
      `).get(snapshot!.id) as { snapshot_id: string; run_id: string; trace_id: string } | undefined;
      expect(row).toEqual({
        snapshot_id: snapshot!.id,
        run_id: 'run-a',
        trace_id: 'trace-a',
      });
    } finally {
      db.close();
    }
  });
});
