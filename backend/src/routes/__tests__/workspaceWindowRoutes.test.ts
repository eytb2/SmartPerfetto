// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import request from 'supertest';
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
import workspaceWindowRoutes from '../workspaceWindowRoutes';

const originalDbPath = process.env.SMARTPERFETTO_ENTERPRISE_DB_PATH;

let tempDir: string;
let dbPath: string;

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use(
    '/api/workspaces/:workspaceId/windows',
    bindWorkspaceRouteContext,
    authenticate,
    requireWorkspaceRouteContext,
    workspaceWindowRoutes,
  );
  return server;
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
  db.close();
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-window-routes-'));
  dbPath = path.join(tempDir, 'enterprise.db');
  process.env.SMARTPERFETTO_ENTERPRISE_DB_PATH = dbPath;
  seedGraph();
});

afterEach(async () => {
  process.env.SMARTPERFETTO_ENTERPRISE_DB_PATH = originalDbPath;
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('workspace window routes', () => {
  test('persists heartbeat and returns active peer windows', async () => {
    await request(app())
      .post('/api/workspaces/workspace-a/windows/window-a/heartbeat')
      .set('x-tenant-id', DEFAULT_TENANT_ID)
      .send({
        traceId: 'trace-a',
        backendTraceId: 'trace-a',
        activeSessionId: 'session-a',
        latestSnapshotId: 'snapshot-a',
        traceTitle: 'Trace A',
        sceneType: 'startup',
      })
      .expect(200);

    const response = await request(app())
      .post('/api/workspaces/workspace-a/windows/window-b/heartbeat')
      .set('x-tenant-id', DEFAULT_TENANT_ID)
      .send({
        traceId: 'trace-b',
        latestSnapshotId: 'snapshot-b',
        traceTitle: 'Trace B',
        sceneType: 'scrolling',
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.windowState.windowId).toBe('window-b');
    expect(response.body.windowState.latestSnapshotId).toBe('snapshot-b');
    expect(response.body.activeWindows.map((item: any) => item.windowId)).toEqual(['window-a']);
    expect(response.body.activeWindows[0].latestSnapshotId).toBe('snapshot-a');
  });

  test('lists active windows while excluding the requester', async () => {
    await request(app())
      .post('/api/workspaces/workspace-a/windows/window-a/heartbeat')
      .set('x-tenant-id', DEFAULT_TENANT_ID)
      .send({ latestSnapshotId: 'snapshot-a', sceneType: 'startup' })
      .expect(200);

    const response = await request(app())
      .get('/api/workspaces/workspace-a/windows/active?excludeWindowId=window-a')
      .set('x-tenant-id', DEFAULT_TENANT_ID)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.activeWindows).toEqual([]);
  });

  test('rejects invalid heartbeat scene type', async () => {
    await request(app())
      .post('/api/workspaces/workspace-a/windows/window-a/heartbeat')
      .set('x-tenant-id', DEFAULT_TENANT_ID)
      .send({ sceneType: 'bad' })
      .expect(400);
  });
});
