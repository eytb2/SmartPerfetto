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
import { EnhancedSessionContext, sessionContextManager } from '../../agent/context/enhancedSessionContext';
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
import { SessionPersistenceService } from '../../services/sessionPersistenceService';
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

function scopedAnalystHeaders(
  req: request.Test,
  options: { userId: string; workspaceId: string; email?: string },
): request.Test {
  return req
    .set('X-SmartPerfetto-SSO-User-Id', options.userId)
    .set('X-SmartPerfetto-SSO-Email', options.email ?? `${options.userId}@example.test`)
    .set('X-SmartPerfetto-SSO-Tenant-Id', 'tenant-a')
    .set('X-SmartPerfetto-SSO-Workspace-Id', options.workspaceId)
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
  SessionPersistenceService.resetForTests();
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
  sessionContextManager.remove('session-resume-integration');
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

  it('keeps concurrent analyzes isolated when one user cancels their own run', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-agent-concurrency-'));
    let leaseStore: ReturnType<typeof getTraceProcessorLeaseStore> | null = null;
    const sessionIds: string[] = [];
    try {
      const traces = new Map<string, { traceId: string; workspaceId: string; userId: string; tracePath: string }>();
      for (const item of [
        { traceId: 'trace-concurrent-a', workspaceId: 'workspace-a', userId: 'analyst-a' },
        { traceId: 'trace-concurrent-b', workspaceId: 'workspace-b', userId: 'analyst-b' },
      ]) {
        const tracePath = path.join(tmpDir, `${item.traceId}.trace`);
        await fs.writeFile(tracePath, `${item.traceId} bytes`);
        traces.set(item.traceId, { ...item, tracePath });
      }

      delete process.env.SMARTPERFETTO_API_KEY;
      process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS = 'true';
      process.env[ENTERPRISE_FEATURE_FLAG_ENV] = 'true';
      process.env[ENTERPRISE_DB_PATH_ENV] = path.join(tmpDir, 'enterprise.sqlite');
      process.env[ENTERPRISE_DATA_DIR_ENV] = path.join(tmpDir, 'data');
      process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');

      for (const item of traces.values()) {
        await writeTraceMetadata({
          id: item.traceId,
          filename: `${item.traceId}.trace`,
          size: 16,
          uploadedAt: new Date().toISOString(),
          status: 'ready',
          path: item.tracePath,
          tenantId: 'tenant-a',
          workspaceId: item.workspaceId,
          userId: item.userId,
        });
      }

      setTraceProcessorServiceForTests({
        getOrLoadTrace: jest.fn(async (traceId: string) => {
          const item = traces.get(traceId);
          if (!item) throw new Error(`missing trace fixture: ${traceId}`);
          return {
            id: item.traceId,
            filename: `${item.traceId}.trace`,
            size: 16,
            filePath: item.tracePath,
            uploadTime: new Date(),
            status: 'ready',
          };
        }),
        getTrace: jest.fn((traceId: string) => {
          const item = traces.get(traceId);
          if (!item) return undefined;
          return {
            id: item.traceId,
            filename: `${item.traceId}.trace`,
            size: 16,
            filePath: item.tracePath,
            uploadTime: new Date(),
            status: 'ready',
          };
        }),
        ensureProcessorForLease: jest.fn(async () => undefined),
        runWithLease: jest.fn(() => new Promise<unknown>(() => undefined)),
        query: jest.fn(async () => ({ columns: [], rows: [], durationMs: 1 })),
      } as any);

      const app = makeApp();
      const [analyzeA, analyzeB] = await Promise.all([
        scopedAnalystHeaders(
          request(app).post('/api/agent/v1/analyze'),
          { userId: 'analyst-a', workspaceId: 'workspace-a' },
        ).send({ traceId: 'trace-concurrent-a', query: 'analyze trace a' }),
        scopedAnalystHeaders(
          request(app).post('/api/agent/v1/analyze'),
          { userId: 'analyst-b', workspaceId: 'workspace-b' },
        ).send({ traceId: 'trace-concurrent-b', query: 'analyze trace b' }),
      ]);

      expect(analyzeA.status).toBe(200);
      expect(analyzeB.status).toBe(200);
      sessionIds.push(analyzeA.body.sessionId, analyzeB.body.sessionId);
      expect(analyzeA.body.sessionId).not.toBe(analyzeB.body.sessionId);
      expect(analyzeA.body.runId).not.toBe(analyzeB.body.runId);

      const [cancelA, statusB] = await Promise.all([
        scopedAnalystHeaders(
          request(app).post(`/api/agent/v1/${analyzeA.body.sessionId}/cancel`),
          { userId: 'analyst-a', workspaceId: 'workspace-a' },
        ),
        scopedAnalystHeaders(
          request(app).get(`/api/agent/v1/${analyzeB.body.sessionId}/status`),
          { userId: 'analyst-b', workspaceId: 'workspace-b' },
        ),
      ]);

      expect(cancelA.status).toBe(200);
      expect(cancelA.body).toEqual(expect.objectContaining({
        sessionId: analyzeA.body.sessionId,
        status: 'failed',
      }));
      expect(statusB.status).toBe(200);
      expect(statusB.body).toEqual(expect.objectContaining({
        sessionId: analyzeB.body.sessionId,
        status: 'running',
      }));

      const crossStatus = await scopedAnalystHeaders(
        request(app).get(`/api/agent/v1/${analyzeB.body.sessionId}/status`),
        { userId: 'analyst-a', workspaceId: 'workspace-a' },
      );
      expect(crossStatus.status).toBe(404);

      const cancelB = await scopedAnalystHeaders(
        request(app).post(`/api/agent/v1/${analyzeB.body.sessionId}/cancel`),
        { userId: 'analyst-b', workspaceId: 'workspace-b' },
      );
      expect(cancelB.status).toBe(200);

      leaseStore = getTraceProcessorLeaseStore();
      expect(leaseStore.listLeases({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'analyst-a',
      }, { traceId: 'trace-concurrent-a' })).toHaveLength(1);
      expect(leaseStore.listLeases({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-b',
        userId: 'analyst-b',
      }, { traceId: 'trace-concurrent-b' })).toHaveLength(1);
    } finally {
      for (const sessionId of sessionIds) {
        sessionContextManager.remove(sessionId);
      }
      leaseStore?.close();
      setTraceProcessorLeaseStoreForTests(null);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('resumes a persisted enterprise session and accepts an authorized respond action', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-agent-resume-'));
    try {
      const traceId = 'trace-resume-integration';
      const sessionId = 'session-resume-integration';
      const tracePath = path.join(tmpDir, `${traceId}.trace`);
      await fs.writeFile(tracePath, 'trace bytes');
      delete process.env.SMARTPERFETTO_API_KEY;
      process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS = 'true';
      process.env[ENTERPRISE_FEATURE_FLAG_ENV] = 'true';
      process.env[ENTERPRISE_DB_PATH_ENV] = path.join(tmpDir, 'enterprise.sqlite');
      process.env[ENTERPRISE_DATA_DIR_ENV] = path.join(tmpDir, 'data');
      process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
      SessionPersistenceService.resetForTests();

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

      const context = new EnhancedSessionContext(sessionId, traceId);
      context.addTurn('resume this persisted session', {
        primaryGoal: 'resume_integration',
        aspects: ['agent_resume', 'respond'],
        expectedOutputType: 'diagnosis',
        complexity: 'moderate',
      });
      const persistence = SessionPersistenceService.getInstance();
      persistence.saveSession({
        id: sessionId,
        traceId,
        traceName: `${traceId}.trace`,
        question: 'resume this persisted session',
        createdAt: Date.now() - 1000,
        updatedAt: Date.now(),
        messages: [],
        metadata: {
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
          userId: 'analyst-user',
        },
      });
      expect(persistence.saveSessionContext(sessionId, context)).toBe(true);

      const resumeRes = await analystHeaders(request(makeApp()).post('/api/agent/v1/resume'))
        .send({ sessionId, traceId });

      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body).toEqual(expect.objectContaining({
        success: true,
        sessionId,
        traceId,
        restored: true,
        status: 'completed',
      }));
      expect(resumeRes.body.restoredStats).toEqual(expect.objectContaining({
        turnCount: 1,
      }));

      const respondRes = await analystHeaders(
        request(makeApp())
          .post(`/api/agent/v1/${sessionId}/respond`)
          .send({ action: 'abort' }),
      );

      expect(respondRes.status).toBe(200);
      expect(respondRes.body).toEqual({
        success: true,
        sessionId,
        status: 'failed',
      });
    } finally {
      sessionContextManager.remove('session-resume-integration');
      SessionPersistenceService.resetForTests();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
