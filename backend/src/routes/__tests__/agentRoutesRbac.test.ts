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
import { ENTERPRISE_DB_PATH_ENV } from '../../services/enterpriseDb';
import { ENTERPRISE_DATA_DIR_ENV, writeTraceMetadata } from '../../services/traceMetadataStore';
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
});
