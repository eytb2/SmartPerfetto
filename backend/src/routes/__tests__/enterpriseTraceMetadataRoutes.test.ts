// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { ENTERPRISE_FEATURE_FLAG_ENV } from '../../config';
import { listEnterpriseAuditEvents } from '../../services/enterpriseAuditService';
import { ENTERPRISE_DB_PATH_ENV, openEnterpriseDb } from '../../services/enterpriseDb';
import { ENTERPRISE_DATA_DIR_ENV } from '../../services/traceMetadataStore';
import { setTraceProcessorServiceForTests } from '../../services/traceProcessorService';
import { getTraceProcessorLeaseStore, setTraceProcessorLeaseStoreForTests } from '../../services/traceProcessorLeaseStore';
import { TraceProcessorFactory } from '../../services/workingTraceProcessor';
import traceRoutes from '../simpleTraceRoutes';

const originalEnv = {
  enterprise: process.env[ENTERPRISE_FEATURE_FLAG_ENV],
  trustedHeaders: process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS,
  enterpriseDbPath: process.env[ENTERPRISE_DB_PATH_ENV],
  enterpriseDataDir: process.env[ENTERPRISE_DATA_DIR_ENV],
  uploadDir: process.env.UPLOAD_DIR,
  apiKey: process.env.SMARTPERFETTO_API_KEY,
};

interface TraceAssetRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  owner_user_id: string | null;
  local_path: string;
  status: string;
  size_bytes: number;
  metadata_json: string;
  expires_at: number | null;
}

let tmpDir: string;
let dbPath: string;
let dataDir: string;
let uploadDir: string;
let fakeTraceProcessorService: {
  initializeUploadWithId: jest.Mock;
  completeUpload: jest.Mock;
  getTraceWithPort: jest.Mock;
  getAllTraces: jest.Mock;
  deleteTrace: jest.Mock;
  cleanupProcessorsForTraces: jest.Mock;
  registerExternalRpc: jest.Mock;
};

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/traces', traceRoutes);
  return app;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function ssoHeaders(req: request.Test, workspaceId = 'workspace-a'): request.Test {
  return req
    .set('X-SmartPerfetto-SSO-User-Id', 'user-a')
    .set('X-SmartPerfetto-SSO-Email', 'user-a@example.test')
    .set('X-SmartPerfetto-SSO-Tenant-Id', 'tenant-a')
    .set('X-SmartPerfetto-SSO-Workspace-Id', workspaceId)
    .set('X-SmartPerfetto-SSO-Roles', 'analyst')
    .set('X-SmartPerfetto-SSO-Scopes', 'trace:read,trace:write,trace:download');
}

function adminHeaders(req: request.Test, workspaceId = 'workspace-a'): request.Test {
  return req
    .set('X-SmartPerfetto-SSO-User-Id', 'admin-a')
    .set('X-SmartPerfetto-SSO-Email', 'admin-a@example.test')
    .set('X-SmartPerfetto-SSO-Tenant-Id', 'tenant-a')
    .set('X-SmartPerfetto-SSO-Workspace-Id', workspaceId)
    .set('X-SmartPerfetto-SSO-Roles', 'workspace_admin')
    .set('X-SmartPerfetto-SSO-Scopes', 'trace:read,trace:write,trace:delete:any,audit:read');
}

function readTraceAsset(traceId: string): TraceAssetRow | null {
  const db = openEnterpriseDb(dbPath);
  try {
    return db.prepare<unknown[], TraceAssetRow>(`
      SELECT *
      FROM trace_assets
      WHERE id = ?
    `).get(traceId) || null;
  } finally {
    db.close();
  }
}

function readTraceProcessorLeases(traceId: string): Array<{
  id: string;
  mode: string;
  state: string;
  rss_bytes: number | null;
  holder_type: string;
  holder_ref: string;
}> {
  const db = openEnterpriseDb(dbPath);
  try {
    return db.prepare<unknown[], {
      id: string;
      mode: string;
      state: string;
      rss_bytes: number | null;
      holder_type: string;
      holder_ref: string;
    }>(`
      SELECT l.id, l.mode, l.state, l.rss_bytes, h.holder_type, h.holder_ref
      FROM trace_processor_leases l
      JOIN trace_processor_holders h ON h.lease_id = l.id
      WHERE l.trace_id = ?
      ORDER BY h.holder_type
    `).all(traceId);
  } finally {
    db.close();
  }
}

function readTraceProcessorLeaseRows(traceId: string): Array<{
  id: string;
  state: string;
  holder_count: number;
}> {
  const db = openEnterpriseDb(dbPath);
  try {
    return db.prepare<unknown[], {
      id: string;
      state: string;
      holder_count: number;
    }>(`
      SELECT l.id, l.state, COUNT(h.id) as holder_count
      FROM trace_processor_leases l
      LEFT JOIN trace_processor_holders h ON h.lease_id = l.id
      WHERE l.trace_id = ?
      GROUP BY l.id
      ORDER BY l.id ASC
    `).all(traceId);
  } finally {
    db.close();
  }
}

function readAuditActions(): string[] {
  const db = openEnterpriseDb(dbPath);
  try {
    return listEnterpriseAuditEvents(db).map(event => event.action);
  } finally {
    db.close();
  }
}

function readCount(table: 'trace_assets' | 'trace_processor_leases'): number {
  const db = openEnterpriseDb(dbPath);
  try {
    return db.prepare<unknown[], { count: number }>(`
      SELECT COUNT(*) as count FROM ${table}
    `).get()?.count ?? 0;
  } finally {
    db.close();
  }
}

function writeWorkspacePolicies(input: {
  quotaPolicy?: Record<string, unknown>;
  retentionPolicy?: Record<string, unknown>;
}): void {
  const db = openEnterpriseDb(dbPath);
  const now = Date.now();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, status, plan, created_at, updated_at)
      VALUES ('tenant-a', 'tenant-a', 'active', 'enterprise', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT OR REPLACE INTO workspaces
        (id, tenant_id, name, retention_policy, quota_policy, created_at, updated_at)
      VALUES
        ('workspace-a', 'tenant-a', 'workspace-a', ?, ?, ?, ?)
    `).run(
      input.retentionPolicy ? JSON.stringify(input.retentionPolicy) : null,
      input.quotaPolicy ? JSON.stringify(input.quotaPolicy) : null,
      now,
      now,
    );
  } finally {
    db.close();
  }
}

function writeTenantTombstone(): void {
  const db = openEnterpriseDb(dbPath);
  const now = Date.now();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, status, plan, created_at, updated_at)
      VALUES ('tenant-a', 'tenant-a', 'tombstoned', 'enterprise', ?, ?)
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
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-enterprise-trace-routes-'));
  dbPath = path.join(tmpDir, 'enterprise.sqlite');
  dataDir = path.join(tmpDir, 'data');
  uploadDir = path.join(tmpDir, 'uploads');

  process.env[ENTERPRISE_FEATURE_FLAG_ENV] = 'true';
  process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS = 'true';
  process.env[ENTERPRISE_DB_PATH_ENV] = dbPath;
  process.env[ENTERPRISE_DATA_DIR_ENV] = dataDir;
  process.env.UPLOAD_DIR = uploadDir;
  delete process.env.SMARTPERFETTO_API_KEY;
  await fs.mkdir(uploadDir, { recursive: true });

  fakeTraceProcessorService = {
    initializeUploadWithId: jest.fn(async () => undefined),
    completeUpload: jest.fn(async () => undefined),
    getTraceWithPort: jest.fn(() => undefined),
    getAllTraces: jest.fn(() => []),
    deleteTrace: jest.fn(async () => undefined),
    cleanupProcessorsForTraces: jest.fn(() => 0),
    registerExternalRpc: jest.fn(async () => undefined),
  };
  setTraceProcessorServiceForTests(fakeTraceProcessorService as any);
});

afterEach(async () => {
  jest.restoreAllMocks();
  setTraceProcessorServiceForTests(null);
  setTraceProcessorLeaseStoreForTests(null);
  restoreEnvValue(ENTERPRISE_FEATURE_FLAG_ENV, originalEnv.enterprise);
  restoreEnvValue('SMARTPERFETTO_SSO_TRUSTED_HEADERS', originalEnv.trustedHeaders);
  restoreEnvValue(ENTERPRISE_DB_PATH_ENV, originalEnv.enterpriseDbPath);
  restoreEnvValue(ENTERPRISE_DATA_DIR_ENV, originalEnv.enterpriseDataDir);
  restoreEnvValue('UPLOAD_DIR', originalEnv.uploadDir);
  restoreEnvValue('SMARTPERFETTO_API_KEY', originalEnv.apiKey);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('enterprise trace metadata routes', () => {
  it('disables legacy direct RPC registration in enterprise mode before creating naked-port state', async () => {
    const app = makeApp();

    const registerRes = await ssoHeaders(
      request(app)
        .post('/api/traces/register-rpc')
        .send({ port: 9123, traceName: 'direct-rpc.trace' }),
    );

    expect(registerRes.status).toBe(410);
    expect(registerRes.body).toEqual(expect.objectContaining({
      success: false,
      error: expect.stringContaining('disabled in enterprise mode'),
    }));
    expect(fakeTraceProcessorService.registerExternalRpc).not.toHaveBeenCalled();
    expect(readCount('trace_assets')).toBe(0);
    expect(readCount('trace_processor_leases')).toBe(0);
  });

  it('stores uploaded trace metadata in trace_assets and moves the trace into scoped data storage', async () => {
    const app = makeApp();
    const sourceTracePath = path.join(tmpDir, 'fixture.trace');
    await fs.writeFile(sourceTracePath, 'trace-content');

    const uploadRes = await ssoHeaders(
      request(app)
        .post('/api/traces/upload')
        .attach('file', sourceTracePath),
    );

    expect(uploadRes.status).toBe(200);
    const traceId = uploadRes.body.trace.id as string;
    expect(uploadRes.body.trace.leaseId).toEqual(expect.any(String));
    expect(uploadRes.body.trace.leaseState).toBe('active');
    expect(uploadRes.body.trace.leaseMode).toBe('shared');
    expect(uploadRes.body.trace.leaseModeReason).toBe('frontend_interactive');
    expect(uploadRes.body.trace.leaseQueueLength).toBe(0);
    const expectedTracePath = path.join(dataDir, 'tenant-a', 'workspace-a', 'traces', `${traceId}.trace`);
    await expect(fs.access(expectedTracePath)).resolves.toBeUndefined();
    await expect(fs.access(path.join(uploadDir, 'traces', `${traceId}.json`))).rejects.toThrow();
    const traceDirFiles = await fs.readdir(path.dirname(expectedTracePath));
    expect(traceDirFiles).toEqual([`${traceId}.trace`]);

    expect(fakeTraceProcessorService.initializeUploadWithId).toHaveBeenCalledWith(
      traceId,
      'fixture.trace',
      'trace-content'.length,
      expectedTracePath,
    );

    const row = readTraceAsset(traceId);
    expect(row).toEqual(expect.objectContaining({
      id: traceId,
      tenant_id: 'tenant-a',
      workspace_id: 'workspace-a',
      owner_user_id: 'user-a',
      local_path: expectedTracePath,
      status: 'ready',
      size_bytes: 'trace-content'.length,
    }));
    expect(JSON.parse(row!.metadata_json)).toEqual(expect.objectContaining({
      filename: 'fixture.trace',
    }));
    expect(readTraceProcessorLeases(traceId)).toEqual([
      expect.objectContaining({
        mode: 'shared',
        state: 'active',
        holder_type: 'frontend_http_rpc',
      }),
    ]);

    const listRes = await ssoHeaders(request(app).get('/api/traces'));
    expect(listRes.status).toBe(200);
    expect(listRes.body.traces.map((trace: any) => trace.id)).toEqual([traceId]);

    const ownTraceRes = await ssoHeaders(request(app).get(`/api/traces/${traceId}`));
    expect(ownTraceRes.status).toBe(200);

    const downloadRes = await ssoHeaders(request(app).get(`/api/traces/${traceId}/file`));
    expect(downloadRes.status).toBe(200);
    expect(
      Buffer.isBuffer(downloadRes.body)
        ? downloadRes.body.toString('utf-8')
        : downloadRes.text,
    ).toBe('trace-content');

    expect(readAuditActions()).toEqual(expect.arrayContaining([
      'trace.uploaded',
      'trace.read',
    ]));

    const otherWorkspaceRes = await ssoHeaders(
      request(app).get(`/api/traces/${traceId}`),
      'workspace-b',
    );
    expect(otherWorkspaceRes.status).toBe(404);
  });

  it('rejects uploads that exceed workspace trace quota before metadata is committed', async () => {
    const app = makeApp();
    writeWorkspacePolicies({
      quotaPolicy: {
        maxTraceBytes: 4,
      },
    });

    const res = await ssoHeaders(
      request(app)
        .post('/api/traces/upload')
        .attach('file', Buffer.from('12345'), 'too-large.trace'),
    );

    expect(res.status).toBe(413);
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      code: 'TRACE_SIZE_QUOTA_EXCEEDED',
      status: 'quota_exceeded',
    }));
    expect(readCount('trace_assets')).toBe(0);
    expect(fakeTraceProcessorService.initializeUploadWithId).not.toHaveBeenCalled();
  });

  it('rejects uploads after tenant tombstone before metadata is committed', async () => {
    const app = makeApp();
    writeTenantTombstone();

    const res = await ssoHeaders(
      request(app)
        .post('/api/traces/upload')
        .attach('file', Buffer.from('trace'), 'tombstoned.trace'),
    );

    expect(res.status).toBe(423);
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      code: 'TENANT_TOMBSTONED',
      status: 'tombstoned',
    }));
    expect(readCount('trace_assets')).toBe(0);
    expect(fakeTraceProcessorService.initializeUploadWithId).not.toHaveBeenCalled();
  });

  it('applies workspace trace retention policy to uploaded trace metadata', async () => {
    const app = makeApp();
    writeWorkspacePolicies({
      retentionPolicy: {
        traceRetentionDays: 3,
      },
    });
    const beforeUpload = Date.now();

    const res = await ssoHeaders(
      request(app)
        .post('/api/traces/upload')
        .attach('file', Buffer.from('trace-with-retention'), 'retained.trace'),
    );

    expect(res.status).toBe(200);
    const row = readTraceAsset(res.body.trace.id);
    expect(row?.expires_at).toBeGreaterThanOrEqual(beforeUpload + 3 * 24 * 60 * 60 * 1000);
    expect(row?.expires_at).toBeLessThanOrEqual(Date.now() + 3 * 24 * 60 * 60 * 1000);
  });

  it('records observed processor RSS on the frontend lease and exposes RAM budget stats', async () => {
    const app = makeApp();
    const sourceTracePath = path.join(tmpDir, 'rss.trace');
    await fs.writeFile(sourceTracePath, 'rss-trace-content');
    let currentTraceId: string | null = null;

    fakeTraceProcessorService.getTraceWithPort.mockImplementation((...args: unknown[]) => {
      const traceId = String(args[0]);
      currentTraceId = traceId;
      return {
        id: traceId,
        filename: 'rss.trace',
        size: 'rss-trace-content'.length,
        uploadTime: new Date('2026-05-08T00:00:00.000Z'),
        status: 'ready',
        port: 9123,
        processor: { status: 'ready' },
      };
    });
    fakeTraceProcessorService.getAllTraces.mockImplementation(() => currentTraceId ? [{
      id: currentTraceId,
      filename: 'rss.trace',
      size: 'rss-trace-content'.length,
      uploadTime: new Date('2026-05-08T00:00:00.000Z'),
      status: 'ready',
    }] : []);
    jest.spyOn(TraceProcessorFactory, 'getStats').mockImplementation(() => ({
      count: currentTraceId ? 1 : 0,
      traceIds: currentTraceId ? [currentTraceId] : [],
      processorKeys: currentTraceId ? [currentTraceId] : [],
      processors: currentTraceId ? [{
        kind: 'owned_process',
        processorId: 'processor-a',
        traceId: currentTraceId,
        status: 'ready',
        activeQueries: 0,
        httpPort: 9123,
        pid: 123,
        rssBytes: 64 * 1024 * 1024,
        startupRssBytes: 48 * 1024 * 1024,
        peakRssBytes: 80 * 1024 * 1024,
        lastRssSampleAt: 1_777_777_777_000,
        rssSampleSource: 'ps',
        sqlWorker: {
          running: true,
          queuedP0: 1,
          queuedP1: 2,
          queuedP2: 3,
          usesWorkerThread: true,
        },
      }] : [],
      ramBudget: {
        enabled: true,
        totalMemoryBytes: 8 * 1024 * 1024 * 1024,
        nodeRssBytes: 128 * 1024 * 1024,
        osSafetyReserveBytes: 1024 * 1024 * 1024,
        uploadReserveBytes: 0,
        machineFactor: 0.60,
        budgetBytes: 2 * 1024 * 1024 * 1024,
        observedProcessorRssBytes: 64 * 1024 * 1024,
        availableForNewLeaseBytes: 1984 * 1024 * 1024,
        activeProcessorCount: currentTraceId ? 1 : 0,
        unknownRssProcessorCount: 0,
        estimateMultiplier: 1.5,
        minEstimateBytes: 128 * 1024 * 1024,
      },
    }));

    const uploadRes = await ssoHeaders(
      request(app)
        .post('/api/traces/upload')
        .attach('file', sourceTracePath),
    );

    expect(uploadRes.status).toBe(200);
    const traceId = uploadRes.body.trace.id as string;
    expect(readTraceProcessorLeases(traceId)).toEqual([
      expect.objectContaining({
        state: 'active',
        rss_bytes: 64 * 1024 * 1024,
        holder_type: 'frontend_http_rpc',
      }),
    ]);

    const statsRes = await ssoHeaders(request(app).get('/api/traces/stats'));

    expect(statsRes.status).toBe(200);
    expect(statsRes.body.stats.ramBudget).toEqual(expect.objectContaining({
      enabled: true,
      observedProcessorRssBytes: 64 * 1024 * 1024,
    }));
    expect(statsRes.body.stats.processors).toEqual(expect.objectContaining({
      count: 1,
      queueLength: 6,
      traceIds: [traceId],
    }));
    expect(statsRes.body.stats.leases).toEqual(expect.objectContaining({
      count: 1,
      activeCount: 1,
      crashCount: 0,
      holderCount: 1,
    }));
    expect(statsRes.body.stats.leases.items[0]).toEqual(expect.objectContaining({
      traceId,
      mode: 'shared',
      rssBytes: 64 * 1024 * 1024,
      queueLength: 6,
      holderCount: 1,
    }));
  });

  it('reports isolated report-generation lease queue length separately from the frontend shared queue', async () => {
    const app = makeApp();
    const sourceTracePath = path.join(tmpDir, 'report-queue.trace');
    await fs.writeFile(sourceTracePath, 'report-queue-content');
    let currentTraceId: string | null = null;
    let reportLeaseId: string | null = null;

    fakeTraceProcessorService.getTraceWithPort.mockImplementation((...args: unknown[]) => {
      const traceId = String(args[0]);
      currentTraceId = traceId;
      return {
        id: traceId,
        filename: 'report-queue.trace',
        size: 'report-queue-content'.length,
        uploadTime: new Date('2026-05-08T00:00:00.000Z'),
        status: 'ready',
        port: 9124,
        processor: { status: 'ready' },
      };
    });
    fakeTraceProcessorService.getAllTraces.mockImplementation(() => currentTraceId ? [{
      id: currentTraceId,
      filename: 'report-queue.trace',
      size: 'report-queue-content'.length,
      uploadTime: new Date('2026-05-08T00:00:00.000Z'),
      status: 'ready',
    }] : []);
    jest.spyOn(TraceProcessorFactory, 'getStats').mockImplementation(() => ({
      count: currentTraceId ? (reportLeaseId ? 2 : 1) : 0,
      traceIds: currentTraceId ? [currentTraceId] : [],
      processorKeys: currentTraceId
        ? [
          currentTraceId,
          ...(reportLeaseId ? [`${currentTraceId}:lease:${reportLeaseId}`] : []),
        ]
        : [],
      processors: currentTraceId ? [
        {
          kind: 'owned_process',
          processorId: 'shared-processor',
          traceId: currentTraceId,
          status: 'ready',
          activeQueries: 0,
          httpPort: 9124,
          leaseMode: 'shared',
          rssBytes: 32 * 1024 * 1024,
          rssSampleSource: 'ps' as const,
          sqlWorker: {
            running: true,
            queuedP0: 1,
            queuedP1: 0,
            queuedP2: 0,
            usesWorkerThread: true,
          },
        },
        ...(reportLeaseId ? [{
          kind: 'owned_process' as const,
          processorId: 'report-processor',
          traceId: currentTraceId,
          status: 'ready' as const,
          activeQueries: 0,
          httpPort: 9125,
          leaseId: reportLeaseId,
          leaseMode: 'isolated',
          rssBytes: 96 * 1024 * 1024,
          rssSampleSource: 'ps' as const,
          sqlWorker: {
            running: true,
            queuedP0: 0,
            queuedP1: 0,
            queuedP2: 7,
            usesWorkerThread: true,
          },
        }] : []),
      ] : [],
      ramBudget: {
        enabled: true,
        totalMemoryBytes: 8 * 1024 * 1024 * 1024,
        nodeRssBytes: 128 * 1024 * 1024,
        osSafetyReserveBytes: 1024 * 1024 * 1024,
        uploadReserveBytes: 0,
        machineFactor: 0.60,
        budgetBytes: 2 * 1024 * 1024 * 1024,
        observedProcessorRssBytes: reportLeaseId ? 128 * 1024 * 1024 : 32 * 1024 * 1024,
        availableForNewLeaseBytes: 1900 * 1024 * 1024,
        activeProcessorCount: currentTraceId ? (reportLeaseId ? 2 : 1) : 0,
        unknownRssProcessorCount: 0,
        estimateMultiplier: 1.5,
        minEstimateBytes: 128 * 1024 * 1024,
      },
    }));

    const uploadRes = await ssoHeaders(
      request(app)
        .post('/api/traces/upload')
        .attach('file', sourceTracePath),
    );

    expect(uploadRes.status).toBe(200);
    const traceId = uploadRes.body.trace.id as string;
    const scope = {
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
    };
    const store = getTraceProcessorLeaseStore();
    const reportLease = store.acquireHolder(scope, traceId, {
      holderType: 'report_generation',
      holderRef: 'report-queue-a',
      reportId: 'report-queue-a',
    }, { mode: 'isolated' });
    reportLeaseId = reportLease.id;
    store.markStarting(scope, reportLease.id);
    store.markReady(scope, reportLease.id);

    const statsRes = await ssoHeaders(request(app).get('/api/traces/stats'));

    expect(statsRes.status).toBe(200);
    expect(statsRes.body.stats.processors.queueLength).toBe(8);
    const leaseItems = statsRes.body.stats.leases.items as Array<{
      id: string;
      mode: string;
      queueLength: number;
      holders: Array<{ holderType: string }>;
    }>;
    const frontendLease = leaseItems.find(item => item.mode === 'shared');
    const reportLeaseItem = leaseItems.find(item => item.id === reportLeaseId);
    expect(frontendLease).toEqual(expect.objectContaining({
      mode: 'shared',
      queueLength: 1,
    }));
    expect(frontendLease?.holders).toEqual([
      expect.objectContaining({ holderType: 'frontend_http_rpc' }),
    ]);
    expect(reportLeaseItem).toEqual(expect.objectContaining({
      mode: 'isolated',
      queueLength: 7,
    }));
    expect(reportLeaseItem?.holders).toEqual([
      expect.objectContaining({ holderType: 'report_generation' }),
    ]);
  });

  it('streams URL uploads into scoped trace storage without buffering the response body', async () => {
    const app = makeApp();
    const traceBytes = 'url-trace-content';
    const response = new Response(traceBytes, {
      status: 200,
      headers: {
        'content-length': String(Buffer.byteLength(traceBytes)),
      },
    });
    const arrayBufferSpy = jest.spyOn(response, 'arrayBuffer').mockImplementation(async () => {
      throw new Error('arrayBuffer should not be used for URL trace uploads');
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(response);

    const uploadRes = await ssoHeaders(
      request(app)
        .post('/api/traces/upload-url')
        .send({ url: 'https://example.test/traces/url-stream.trace' }),
    );

    expect(uploadRes.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.test/traces/url-stream.trace',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(arrayBufferSpy).not.toHaveBeenCalled();

    const traceId = uploadRes.body.trace.id as string;
    const expectedTracePath = path.join(dataDir, 'tenant-a', 'workspace-a', 'traces', `${traceId}.trace`);
    await expect(fs.readFile(expectedTracePath, 'utf-8')).resolves.toBe(traceBytes);
    const traceDirFiles = await fs.readdir(path.dirname(expectedTracePath));
    expect(traceDirFiles).toEqual([`${traceId}.trace`]);

    expect(fakeTraceProcessorService.initializeUploadWithId).toHaveBeenCalledWith(
      traceId,
      'url-stream.trace',
      Buffer.byteLength(traceBytes),
      expectedTracePath,
    );
  });

  it('blocks enterprise cleanup when scoped trace processor leases still have active holders and audits the attempt', async () => {
    const app = makeApp();
    const sourceTracePath = path.join(tmpDir, 'active-cleanup.trace');
    await fs.writeFile(sourceTracePath, 'active-cleanup');

    const uploadRes = await ssoHeaders(
      request(app)
        .post('/api/traces/upload')
        .attach('file', sourceTracePath),
    );
    expect(uploadRes.status).toBe(200);
    const traceId = uploadRes.body.trace.id as string;

    const cleanupRes = await adminHeaders(request(app).post('/api/traces/cleanup'));

    expect(cleanupRes.status).toBe(409);
    expect(cleanupRes.body).toEqual(expect.objectContaining({
      success: false,
      error: 'Trace cleanup blocked by active trace processor leases',
    }));
    expect(cleanupRes.body.blockedLeases).toEqual([
      expect.objectContaining({
        traceId,
        holderCount: 1,
        holderTypes: ['frontend_http_rpc'],
      }),
    ]);
    expect(fakeTraceProcessorService.cleanupProcessorsForTraces).not.toHaveBeenCalled();
    expect(readTraceProcessorLeaseRows(traceId)).toEqual([
      expect.objectContaining({
        state: 'active',
        holder_count: 1,
      }),
    ]);
    expect(readAuditActions()).toContain('trace_cleanup_blocked');
  });

  it('hides enterprise cleanup from non-admin analysts', async () => {
    const app = makeApp();

    const cleanupRes = await ssoHeaders(request(app).post('/api/traces/cleanup'));

    expect(cleanupRes.status).toBe(404);
    expect(cleanupRes.body.success).toBe(false);
    expect(fakeTraceProcessorService.cleanupProcessorsForTraces).not.toHaveBeenCalled();
    expect(readAuditActions()).not.toContain('trace_cleanup_completed');
  });

  it('drains idle enterprise leases before scoped processor cleanup and records an audit event', async () => {
    const app = makeApp();
    const sourceTracePath = path.join(tmpDir, 'idle-cleanup.trace');
    await fs.writeFile(sourceTracePath, 'idle-cleanup');

    const uploadRes = await ssoHeaders(
      request(app)
        .post('/api/traces/upload')
        .attach('file', sourceTracePath),
    );
    expect(uploadRes.status).toBe(200);
    const traceId = uploadRes.body.trace.id as string;
    const scope = {
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
    };
    const store = getTraceProcessorLeaseStore();
    const lease = store.listLeases(scope, { traceId })[0]!;
    for (const holder of lease.holders) {
      store.releaseHolder(scope, lease.id, holder.holderType, holder.holderRef);
    }

    fakeTraceProcessorService.cleanupProcessorsForTraces.mockImplementation((traceIds: unknown) => {
      expect(Array.from(traceIds as Iterable<string>)).toEqual([traceId]);
      return 1;
    });

    const cleanupRes = await adminHeaders(request(app).post('/api/traces/cleanup'));

    expect(cleanupRes.status).toBe(200);
    expect(cleanupRes.body).toEqual(expect.objectContaining({
      success: true,
      releasedLeaseIds: [lease.id],
      cleanedProcessors: 1,
      traceCount: 1,
    }));
    expect(fakeTraceProcessorService.cleanupProcessorsForTraces).toHaveBeenCalledTimes(1);
    expect(readTraceProcessorLeaseRows(traceId)).toEqual([
      expect.objectContaining({
        state: 'released',
        holder_count: 0,
      }),
    ]);
    expect(readAuditActions()).toContain('trace_cleanup_completed');
  });

  it('blocks enterprise trace delete while runs, active leases, or report holders still own the trace', async () => {
    const app = makeApp();
    const sourceTracePath = path.join(tmpDir, 'active-delete.trace');
    await fs.writeFile(sourceTracePath, 'active-delete');

    const uploadRes = await ssoHeaders(
      request(app)
        .post('/api/traces/upload')
        .attach('file', sourceTracePath),
    );
    expect(uploadRes.status).toBe(200);
    const traceId = uploadRes.body.trace.id as string;
    const row = readTraceAsset(traceId);
    expect(row).not.toBeNull();

    const now = Date.now();
    const sessionId = 'session-active-delete';
    const runId = 'run-active-delete';
    const db = openEnterpriseDb(dbPath);
    try {
      db.prepare(`
        INSERT INTO analysis_sessions
          (id, tenant_id, workspace_id, trace_id, created_by, title, visibility, status, created_at, updated_at)
        VALUES (?, 'tenant-a', 'workspace-a', ?, 'user-a', 'active delete', 'private', 'running', ?, ?)
      `).run(sessionId, traceId, now, now);
      db.prepare(`
        INSERT INTO analysis_runs
          (id, tenant_id, workspace_id, session_id, mode, status, question, started_at)
        VALUES (?, 'tenant-a', 'workspace-a', ?, 'full', 'running', 'active delete', ?)
      `).run(runId, sessionId, now);
    } finally {
      db.close();
    }

    const scope = {
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
    };
    const store = getTraceProcessorLeaseStore();
    const lease = store.listLeases(scope, { traceId })[0]!;
    store.acquireHolderForLease(scope, lease.id, {
      holderType: 'report_generation',
      holderRef: 'report-active-delete',
      reportId: 'report-active-delete',
    });

    const deleteRes = await ssoHeaders(request(app).delete(`/api/traces/${traceId}`));

    expect(deleteRes.status).toBe(409);
    expect(deleteRes.body).toEqual(expect.objectContaining({
      success: false,
      error: 'Trace delete blocked by active analysis runs or trace processor leases',
      activeRuns: [
        expect.objectContaining({ runId, sessionId, status: 'running' }),
      ],
    }));
    expect(deleteRes.body.blockedLeases).toEqual([
      expect.objectContaining({
        traceId,
        state: 'draining',
        holderCount: 2,
        holderTypes: expect.arrayContaining(['frontend_http_rpc', 'report_generation']),
      }),
    ]);
    expect(fakeTraceProcessorService.deleteTrace).not.toHaveBeenCalled();
    await expect(fs.access(row!.local_path)).resolves.toBeUndefined();
    expect(readTraceAsset(traceId)).not.toBeNull();
    expect(readTraceProcessorLeaseRows(traceId)).toEqual([
      expect.objectContaining({
        state: 'draining',
        holder_count: 2,
      }),
    ]);
    expect(readAuditActions()).toContain('trace_delete_blocked');
  });

  it('deletes enterprise trace files and trace_assets metadata through the scoped owner path', async () => {
    const app = makeApp();
    const sourceTracePath = path.join(tmpDir, 'delete-me.trace');
    await fs.writeFile(sourceTracePath, 'delete-me');

    const uploadRes = await ssoHeaders(
      request(app)
        .post('/api/traces/upload')
        .attach('file', sourceTracePath),
    );
    expect(uploadRes.status).toBe(200);
    const traceId = uploadRes.body.trace.id as string;
    const row = readTraceAsset(traceId);
    expect(row).not.toBeNull();
    const scope = {
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
    };
    const store = getTraceProcessorLeaseStore();
    const lease = store.listLeases(scope, { traceId })[0];
    for (const holder of lease.holders) {
      store.releaseHolder(scope, lease.id, holder.holderType, holder.holderRef);
    }

    const deleteRes = await ssoHeaders(request(app).delete(`/api/traces/${traceId}`));

    expect(deleteRes.status).toBe(200);
    expect(fakeTraceProcessorService.deleteTrace).toHaveBeenCalledWith(traceId);
    await expect(fs.access(row!.local_path)).rejects.toThrow();
    expect(readTraceAsset(traceId)).toBeNull();
    expect(readAuditActions()).toEqual(expect.arrayContaining([
      'trace.uploaded',
      'trace.deleted',
    ]));
  });
});
