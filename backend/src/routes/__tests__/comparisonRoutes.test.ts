// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import request from 'supertest';
import {
  ANALYSIS_RESULT_SNAPSHOT_SCHEMA_VERSION,
  type AnalysisResultSnapshot,
  type NormalizedMetricValue,
} from '../../types/multiTraceComparison';
import {
  authenticate,
  DEFAULT_DEV_USER_ID,
  DEFAULT_TENANT_ID,
} from '../../middleware/auth';
import {
  bindWorkspaceRouteContext,
  requireWorkspaceRouteContext,
} from '../../middleware/workspaceRouteContext';
import { openEnterpriseDb } from '../../services/enterpriseDb';
import { createAnalysisResultSnapshotRepository } from '../../services/analysisResultSnapshotStore';
import comparisonRoutes from '../comparisonRoutes';

const originalDbPath = process.env.SMARTPERFETTO_ENTERPRISE_DB_PATH;
const originalComparisonAiDisabled = process.env.SMARTPERFETTO_COMPARISON_AI_DISABLED;

let tempDir: string;
let dbPath: string;

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use(
    '/api/workspaces/:workspaceId/comparisons',
    bindWorkspaceRouteContext,
    authenticate,
    requireWorkspaceRouteContext,
    comparisonRoutes,
  );
  return server;
}

function metrics(values: {
  startupMs: number;
  fps: number;
  jankRate: number;
}): NormalizedMetricValue[] {
  return [
    {
      key: 'startup.total_ms',
      label: 'Startup total duration',
      group: 'startup',
      value: values.startupMs,
      unit: 'ms',
      direction: 'lower_is_better',
      aggregation: 'single',
      confidence: 0.9,
      source: { type: 'skill' },
    },
    {
      key: 'scrolling.avg_fps',
      label: 'Average FPS',
      group: 'fps',
      value: values.fps,
      unit: 'fps',
      direction: 'higher_is_better',
      aggregation: 'avg',
      confidence: 0.9,
      source: { type: 'skill' },
    },
    {
      key: 'scrolling.jank_rate_pct',
      label: 'Jank rate',
      group: 'jank',
      value: values.jankRate,
      unit: '%',
      direction: 'lower_is_better',
      aggregation: 'avg',
      confidence: 0.9,
      source: { type: 'skill' },
    },
  ];
}

function snapshot(overrides: Partial<AnalysisResultSnapshot>): AnalysisResultSnapshot {
  const id = overrides.id || 'snapshot-a';
  return {
    id,
    tenantId: DEFAULT_TENANT_ID,
    workspaceId: 'workspace-a',
    traceId: 'trace-a',
    sessionId: 'session-a',
    runId: 'run-a',
    createdBy: DEFAULT_DEV_USER_ID,
    visibility: 'private',
    sceneType: 'startup',
    title: id,
    userQuery: 'analyze startup',
    traceLabel: 'trace-a',
    traceMetadata: {},
    summary: { headline: 'ok' },
    metrics: metrics({ startupMs: 1200, fps: 55, jankRate: 8 }),
    evidenceRefs: [],
    status: 'ready',
    schemaVersion: ANALYSIS_RESULT_SNAPSHOT_SCHEMA_VERSION,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function seedGraph(): void {
  const db = openEnterpriseDb(dbPath);
  const now = 1_700_000_000_000;
  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, status, plan, created_at, updated_at)
    VALUES (?, ?, 'active', 'enterprise', ?, ?)
  `).run(DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, now, now);
  db.prepare(`
    INSERT OR IGNORE INTO workspaces (id, tenant_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('workspace-a', DEFAULT_TENANT_ID, 'workspace-a', now, now);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, tenant_id, email, display_name, idp_subject, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(DEFAULT_DEV_USER_ID, DEFAULT_TENANT_ID, 'dev@example.test', 'Dev', 'dev', now, now);
  for (const [traceId, sessionId, runId] of [
    ['trace-a', 'session-a', 'run-a'],
    ['trace-b', 'session-b', 'run-b'],
  ]) {
    db.prepare(`
      INSERT INTO trace_assets
        (id, tenant_id, workspace_id, owner_user_id, local_path, status, created_at)
      VALUES
        (?, ?, 'workspace-a', ?, ?, 'ready', ?)
    `).run(traceId, DEFAULT_TENANT_ID, DEFAULT_DEV_USER_ID, `/tmp/${traceId}`, now);
    db.prepare(`
      INSERT INTO analysis_sessions
        (id, tenant_id, workspace_id, trace_id, created_by, title, visibility, status, created_at, updated_at)
      VALUES
        (?, ?, 'workspace-a', ?, ?, ?, 'private', 'completed', ?, ?)
    `).run(sessionId, DEFAULT_TENANT_ID, traceId, DEFAULT_DEV_USER_ID, sessionId, now, now);
    db.prepare(`
      INSERT INTO analysis_runs
        (id, tenant_id, workspace_id, session_id, mode, status, question, started_at, completed_at)
      VALUES
        (?, ?, 'workspace-a', ?, 'agent', 'completed', 'analyze', ?, ?)
    `).run(runId, DEFAULT_TENANT_ID, sessionId, now, now);
  }
  const repo = createAnalysisResultSnapshotRepository(db);
  repo.createSnapshot(snapshot({ id: 'snapshot-a' }));
  repo.createSnapshot(snapshot({
    id: 'snapshot-b',
    traceId: 'trace-b',
    sessionId: 'session-b',
    runId: 'run-b',
    visibility: 'workspace',
    metrics: metrics({ startupMs: 900, fps: 60, jankRate: 3 }),
  }));
  db.close();
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-comparisons-'));
  dbPath = path.join(tempDir, 'enterprise.db');
  process.env.SMARTPERFETTO_ENTERPRISE_DB_PATH = dbPath;
  process.env.SMARTPERFETTO_COMPARISON_AI_DISABLED = 'true';
  seedGraph();
});

afterEach(async () => {
  process.env.SMARTPERFETTO_ENTERPRISE_DB_PATH = originalDbPath;
  process.env.SMARTPERFETTO_COMPARISON_AI_DISABLED = originalComparisonAiDisabled;
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('comparison routes', () => {
  test('creates completed startup/fps/jank comparison result for two readable snapshots', async () => {
    const createResponse = await request(app())
      .post('/api/workspaces/workspace-a/comparisons')
      .set('x-tenant-id', DEFAULT_TENANT_ID)
      .send({
        baselineSnapshotId: 'snapshot-a',
        candidateSnapshotIds: ['snapshot-b'],
        query: 'compare startup',
      })
      .expect(201);

    expect(createResponse.body.success).toBe(true);
    expect(createResponse.body.comparison.status).toBe('completed');
    expect(createResponse.body.comparison.inputSnapshotIds).toEqual([
      'snapshot-a',
      'snapshot-b',
    ]);
    expect(createResponse.body.comparison.result.matrix.rows.map((row: { metricKey: string }) => row.metricKey)).toEqual([
      'startup.total_ms',
      'scrolling.avg_fps',
      'scrolling.jank_rate_pct',
    ]);

    const rows = createResponse.body.comparison.result.matrix.rows as Array<{
      metricKey: string;
      deltas: Array<{ deltaValue: number; deltaPct: number; assessment: string }>;
    }>;
    expect(rows.find(row => row.metricKey === 'startup.total_ms')?.deltas[0]).toMatchObject({
      deltaValue: -300,
      deltaPct: -25,
      assessment: 'better',
    });
    expect(rows.find(row => row.metricKey === 'scrolling.avg_fps')?.deltas[0]).toMatchObject({
      deltaValue: 5,
      assessment: 'better',
    });
    expect(rows.find(row => row.metricKey === 'scrolling.jank_rate_pct')?.deltas[0]).toMatchObject({
      deltaValue: -5,
      assessment: 'better',
    });
    expect(createResponse.body.comparison.result.significantChanges).toHaveLength(3);

    const comparisonId = createResponse.body.comparison.id;
    const readResponse = await request(app())
      .get(`/api/workspaces/workspace-a/comparisons/${comparisonId}`)
      .set('x-tenant-id', DEFAULT_TENANT_ID)
      .expect(200);

    expect(readResponse.body.comparison.id).toBe(comparisonId);
    expect(readResponse.body.comparison.status).toBe('completed');
    expect(readResponse.body.comparison.result.matrix.rows).toHaveLength(3);
  });

  test('rejects missing candidate snapshots', async () => {
    await request(app())
      .post('/api/workspaces/workspace-a/comparisons')
      .set('x-tenant-id', DEFAULT_TENANT_ID)
      .send({
        baselineSnapshotId: 'snapshot-a',
        candidateSnapshotIds: [],
      })
      .expect(400);
  });

  test('streams the current comparison state as SSE', async () => {
    const createResponse = await request(app())
      .post('/api/workspaces/workspace-a/comparisons')
      .set('x-tenant-id', DEFAULT_TENANT_ID)
      .send({
        baselineSnapshotId: 'snapshot-a',
        candidateSnapshotIds: ['snapshot-b'],
      })
      .expect(201);

    const response = await request(app())
      .get(`/api/workspaces/workspace-a/comparisons/${createResponse.body.comparison.id}/stream`)
      .set('x-tenant-id', DEFAULT_TENANT_ID)
      .expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('event: comparison_state');
    expect(response.text).toContain(createResponse.body.comparison.id);
  });
});
