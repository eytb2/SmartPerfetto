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
import { ENTERPRISE_DB_PATH_ENV, openEnterpriseDb } from '../../services/enterpriseDb';
import { ENTERPRISE_DATA_DIR_ENV } from '../../services/traceMetadataStore';
import { setTraceProcessorServiceForTests } from '../../services/traceProcessorService';
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
  };
  setTraceProcessorServiceForTests(fakeTraceProcessorService as any);
});

afterEach(async () => {
  jest.restoreAllMocks();
  setTraceProcessorServiceForTests(null);
  restoreEnvValue(ENTERPRISE_FEATURE_FLAG_ENV, originalEnv.enterprise);
  restoreEnvValue('SMARTPERFETTO_SSO_TRUSTED_HEADERS', originalEnv.trustedHeaders);
  restoreEnvValue(ENTERPRISE_DB_PATH_ENV, originalEnv.enterpriseDbPath);
  restoreEnvValue(ENTERPRISE_DATA_DIR_ENV, originalEnv.enterpriseDataDir);
  restoreEnvValue('UPLOAD_DIR', originalEnv.uploadDir);
  restoreEnvValue('SMARTPERFETTO_API_KEY', originalEnv.apiKey);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('enterprise trace metadata routes', () => {
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

    const otherWorkspaceRes = await ssoHeaders(
      request(app).get(`/api/traces/${traceId}`),
      'workspace-b',
    );
    expect(otherWorkspaceRes.status).toBe(404);
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

    const deleteRes = await ssoHeaders(request(app).delete(`/api/traces/${traceId}`));

    expect(deleteRes.status).toBe(200);
    expect(fakeTraceProcessorService.deleteTrace).toHaveBeenCalledWith(traceId);
    await expect(fs.access(row!.local_path)).rejects.toThrow();
    expect(readTraceAsset(traceId)).toBeNull();
  });
});
