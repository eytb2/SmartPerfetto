// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { ENTERPRISE_FEATURE_FLAG_ENV } from '../../config';
import { ENTERPRISE_DB_PATH_ENV, openEnterpriseDb } from '../../services/enterpriseDb';
import { ENTERPRISE_DATA_DIR_ENV, writeTraceMetadata } from '../../services/traceMetadataStore';
import {
  persistSerializedAgentEvent,
  resetAgentEventStoreForTests,
} from '../../services/agentEventStore';
import {
  getAnalysisRunLifecycle,
  resetAnalysisRunStoreForTests,
} from '../../services/analysisRunStore';
import {
  getTraceProcessorLeaseStore,
  setTraceProcessorLeaseStoreForTests,
} from '../../services/traceProcessorLeaseStore';
import { setTraceProcessorServiceForTests } from '../../services/traceProcessorService';
import agentRoutes from '../agentRoutes';

const originalApiKey = process.env.SMARTPERFETTO_API_KEY;
const originalSsoTrustedHeaders = process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS;
const originalEnterprise = process.env[ENTERPRISE_FEATURE_FLAG_ENV];
const originalEnterpriseDbPath = process.env[ENTERPRISE_DB_PATH_ENV];
const originalEnterpriseDataDir = process.env[ENTERPRISE_DATA_DIR_ENV];
const originalUploadDir = process.env.UPLOAD_DIR;

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/agent/v1', agentRoutes);
  return app;
}

function viewerHeaders(req: request.Test): request.Test {
  return req
    .set('X-SmartPerfetto-SSO-User-Id', 'viewer-user')
    .set('X-SmartPerfetto-SSO-Email', 'viewer@example.test')
    .set('X-SmartPerfetto-SSO-Tenant-Id', 'tenant-a')
    .set('X-SmartPerfetto-SSO-Workspace-Id', 'workspace-a')
    .set('X-SmartPerfetto-SSO-Roles', 'viewer')
    .set('X-SmartPerfetto-SSO-Scopes', 'trace:read,report:read');
}

function analystHeaders(req: request.Test): request.Test {
  return req
    .set('X-SmartPerfetto-SSO-User-Id', 'analyst-user')
    .set('X-SmartPerfetto-SSO-Email', 'analyst@example.test')
    .set('X-SmartPerfetto-SSO-Tenant-Id', 'tenant-a')
    .set('X-SmartPerfetto-SSO-Workspace-Id', 'workspace-a')
    .set('X-SmartPerfetto-SSO-Roles', 'analyst')
    .set('X-SmartPerfetto-SSO-Scopes', 'trace:read,trace:write,agent:run,report:read');
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(async () => {
  jest.restoreAllMocks();
  setTraceProcessorServiceForTests(null);
  setTraceProcessorLeaseStoreForTests(null);
  resetAgentEventStoreForTests();
  resetAnalysisRunStoreForTests();
  if (originalApiKey === undefined) {
    delete process.env.SMARTPERFETTO_API_KEY;
  } else {
    process.env.SMARTPERFETTO_API_KEY = originalApiKey;
  }
  restoreEnvValue('SMARTPERFETTO_SSO_TRUSTED_HEADERS', originalSsoTrustedHeaders);
  restoreEnvValue(ENTERPRISE_FEATURE_FLAG_ENV, originalEnterprise);
  restoreEnvValue(ENTERPRISE_DB_PATH_ENV, originalEnterpriseDbPath);
  restoreEnvValue(ENTERPRISE_DATA_DIR_ENV, originalEnterpriseDataDir);
  restoreEnvValue('UPLOAD_DIR', originalUploadDir);
});

describe('agent route RBAC', () => {
  it('rejects viewer analyze requests before trace access is evaluated', async () => {
    delete process.env.SMARTPERFETTO_API_KEY;
    process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS = 'true';

    const res = await viewerHeaders(request(makeApp()).post('/api/agent/v1/analyze'))
      .send({ traceId: 'trace-a', query: 'analyze this trace' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(res.body.details).toContain('agent:run');
  });

  it('rejects analyze requests after tenant tombstone before trace access is evaluated', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-agent-tombstone-'));
    try {
      delete process.env.SMARTPERFETTO_API_KEY;
      process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS = 'true';
      process.env[ENTERPRISE_FEATURE_FLAG_ENV] = 'true';
      process.env[ENTERPRISE_DB_PATH_ENV] = path.join(tmpDir, 'enterprise.sqlite');
      process.env[ENTERPRISE_DATA_DIR_ENV] = path.join(tmpDir, 'data');

      const db = openEnterpriseDb();
      const now = Date.now();
      try {
        db.prepare(`
          INSERT INTO organizations (id, name, status, plan, created_at, updated_at)
          VALUES ('tenant-a', 'Tenant A', 'tombstoned', 'enterprise', ?, ?)
        `).run(now, now);
        db.prepare(`
          INSERT INTO tenant_tombstones
            (tenant_id, requested_by, requested_at, purge_after, status, proof_hash)
          VALUES
            ('tenant-a', NULL, ?, ?, 'tombstoned', NULL)
        `).run(now, now + 7 * 24 * 60 * 60 * 1000);
      } finally {
        db.close();
      }
      const traceService = { getOrLoadTrace: jest.fn() };
      setTraceProcessorServiceForTests(traceService as any);

      const res = await analystHeaders(request(makeApp()).post('/api/agent/v1/analyze'))
        .send({ traceId: 'trace-a', query: 'analyze this trace' });

      expect(res.status).toBe(423);
      expect(res.body).toEqual(expect.objectContaining({
        success: false,
        code: 'TENANT_TOMBSTONED',
        status: 'tombstoned',
      }));
      expect(traceService.getOrLoadTrace).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects analyze when the scoped trace processor lease is draining', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-agent-lease-'));
    let leaseStore: ReturnType<typeof getTraceProcessorLeaseStore> | null = null;
    try {
      const traceId = 'trace-draining';
      const tracePath = path.join(tmpDir, `${traceId}.trace`);
      await fs.writeFile(tracePath, 'trace bytes');
      delete process.env.SMARTPERFETTO_API_KEY;
      process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS = 'true';
      process.env[ENTERPRISE_FEATURE_FLAG_ENV] = 'true';
      process.env[ENTERPRISE_DB_PATH_ENV] = path.join(tmpDir, 'enterprise.sqlite');
      process.env[ENTERPRISE_DATA_DIR_ENV] = path.join(tmpDir, 'data');
      process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');

      await writeTraceMetadata({
        id: traceId,
        filename: `${traceId}.trace`,
        size: 11,
        uploadedAt: new Date().toISOString(),
        status: 'ready',
        path: tracePath,
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'analyst-user',
      });
      setTraceProcessorServiceForTests({
        getOrLoadTrace: jest.fn(async () => ({
          id: traceId,
          filename: `${traceId}.trace`,
          size: 11,
          filePath: tracePath,
          uploadTime: new Date(),
          status: 'ready',
        })),
      } as any);

      const scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a', userId: 'analyst-user' };
      leaseStore = getTraceProcessorLeaseStore();
      const lease = leaseStore.acquireHolder(scope, traceId, {
        holderType: 'manual_register',
        holderRef: 'port:9100',
      });
      leaseStore.markStarting(scope, lease.id);
      leaseStore.markReady(scope, lease.id);
      leaseStore.beginDraining(scope, lease.id);

      const res = await analystHeaders(request(makeApp()).post('/api/agent/v1/analyze'))
        .send({ traceId, query: 'analyze this trace' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TRACE_PROCESSOR_LEASE_UNAVAILABLE');
    } finally {
      leaseStore?.close();
      setTraceProcessorLeaseStoreForTests(null);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('selects an isolated lease for full analysis runs', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-agent-lease-mode-'));
    let leaseStore: ReturnType<typeof getTraceProcessorLeaseStore> | null = null;
    try {
      const traceId = 'trace-full-analysis';
      const tracePath = path.join(tmpDir, `${traceId}.trace`);
      await fs.writeFile(tracePath, 'trace bytes');
      delete process.env.SMARTPERFETTO_API_KEY;
      process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS = 'true';
      process.env[ENTERPRISE_FEATURE_FLAG_ENV] = 'true';
      process.env[ENTERPRISE_DB_PATH_ENV] = path.join(tmpDir, 'enterprise.sqlite');
      process.env[ENTERPRISE_DATA_DIR_ENV] = path.join(tmpDir, 'data');
      process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');

      await writeTraceMetadata({
        id: traceId,
        filename: `${traceId}.trace`,
        size: 11,
        uploadedAt: new Date().toISOString(),
        status: 'ready',
        path: tracePath,
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'analyst-user',
      });
      setTraceProcessorServiceForTests({
        getOrLoadTrace: jest.fn(async () => ({
          id: traceId,
          filename: `${traceId}.trace`,
          size: 11,
          filePath: tracePath,
          uploadTime: new Date(),
          status: 'ready',
        })),
        getTrace: jest.fn(() => ({
          id: traceId,
          filename: `${traceId}.trace`,
          size: 11,
          filePath: tracePath,
          uploadTime: new Date(),
          status: 'ready',
        })),
        ensureProcessorForLease: jest.fn(async () => undefined),
        runWithLease: jest.fn(async (_lease, fn: () => Promise<unknown>) => fn()),
        query: jest.fn(async () => ({ columns: [], rows: [], durationMs: 1 })),
      } as any);

      const res = await analystHeaders(request(makeApp()).post('/api/agent/v1/analyze'))
        .send({
          traceId,
          query: 'analyze this trace',
          options: { analysisMode: 'full' },
        });

      expect(res.status).toBe(200);
      expect(res.body.leaseState).toBe('active');
      expect(res.body.leaseMode).toBe('isolated');
      expect(res.body.leaseModeReason).toBe('full_analysis');
      expect(res.body.leaseQueueLength).toBe(0);

      const scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a', userId: 'analyst-user' };
      leaseStore = getTraceProcessorLeaseStore();
      const leases = leaseStore.listLeases(scope, { traceId });
      expect(leases).toHaveLength(1);
      expect(leases[0]).toMatchObject({
        id: res.body.leaseId,
        mode: 'isolated',
      });
      expect(['active', 'idle']).toContain(leases[0].state);
    } finally {
      leaseStore?.close();
      setTraceProcessorLeaseStoreForTests(null);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('replays persisted terminal SSE events before falling back to the in-memory buffer', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-agent-event-replay-'));
    let leaseStore: ReturnType<typeof getTraceProcessorLeaseStore> | null = null;
    try {
      const traceId = 'trace-agent-event-replay';
      const tracePath = path.join(tmpDir, `${traceId}.trace`);
      await fs.writeFile(tracePath, 'trace bytes');
      delete process.env.SMARTPERFETTO_API_KEY;
      process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS = 'true';
      process.env[ENTERPRISE_FEATURE_FLAG_ENV] = 'true';
      process.env[ENTERPRISE_DB_PATH_ENV] = path.join(tmpDir, 'enterprise.sqlite');
      process.env[ENTERPRISE_DATA_DIR_ENV] = path.join(tmpDir, 'data');
      process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');

      await writeTraceMetadata({
        id: traceId,
        filename: `${traceId}.trace`,
        size: 11,
        uploadedAt: new Date().toISOString(),
        status: 'ready',
        path: tracePath,
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'analyst-user',
      });
      setTraceProcessorServiceForTests({
        getOrLoadTrace: jest.fn(async () => ({
          id: traceId,
          filename: `${traceId}.trace`,
          size: 11,
          filePath: tracePath,
          uploadTime: new Date(),
          status: 'ready',
        })),
        getTrace: jest.fn(() => ({
          id: traceId,
          filename: `${traceId}.trace`,
          size: 11,
          filePath: tracePath,
          uploadTime: new Date(),
          status: 'ready',
        })),
        ensureProcessorForLease: jest.fn(async () => undefined),
        runWithLease: jest.fn(() => new Promise<unknown>(() => undefined)),
        query: jest.fn(async () => ({ columns: [], rows: [], durationMs: 1 })),
      } as any);

      const analyzeRes = await analystHeaders(request(makeApp()).post('/api/agent/v1/analyze'))
        .send({ traceId, query: 'analyze this trace' });

      expect(analyzeRes.status).toBe(200);
      const { sessionId, runId } = analyzeRes.body;
      const persistedRun = getAnalysisRunLifecycle({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'analyst-user',
      }, runId);
      expect(persistedRun).toEqual(expect.objectContaining({
        id: runId,
        status: 'running',
      }));
      expect(persistedRun?.heartbeatAt).toEqual(expect.any(Number));
      persistSerializedAgentEvent({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'analyst-user',
        sessionId,
        runId,
        traceId,
        query: 'analyze this trace',
      }, {
        cursor: 99,
        eventType: 'analysis_completed',
        eventData: JSON.stringify({
          type: 'analysis_completed',
          data: { reportUrl: '/api/reports/report-from-db' },
        }),
        createdAt: 1_777_000_002_000,
      });

      const streamRes = await analystHeaders(
        request(makeApp())
          .get(`/api/agent/v1/${sessionId}/stream`)
          .set('Last-Event-ID', '98')
          .set('Accept', 'text/event-stream'),
      );

      expect(streamRes.status).toBe(200);
      expect(streamRes.text).toContain('id: 99');
      expect(streamRes.text).toContain('event: analysis_completed');
      expect(streamRes.text).toContain('/api/reports/report-from-db');
      leaseStore = getTraceProcessorLeaseStore();
      expect(leaseStore.listLeases({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'analyst-user',
      }, { traceId })).toHaveLength(1);
    } finally {
      leaseStore?.close();
      setTraceProcessorLeaseStoreForTests(null);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
