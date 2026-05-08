// SPDX-License-Identifier: AGPL-3.0-or-later

import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { ENTERPRISE_FEATURE_FLAG_ENV } from '../../../config';
import { listEnterpriseAuditEvents } from '../../enterpriseAuditService';
import { ENTERPRISE_DB_PATH_ENV, openEnterpriseDb } from '../../enterpriseDb';
import {
  SECRET_STORE_ALLOW_LOCAL_MASTER_KEY_ENV,
  SECRET_STORE_DIR_ENV,
} from '../localSecretStore';
import { resetProviderService } from '../index';

const originalEnv = {
  enterprise: process.env[ENTERPRISE_FEATURE_FLAG_ENV],
  trustedHeaders: process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS,
  enterpriseDbPath: process.env[ENTERPRISE_DB_PATH_ENV],
  secretStoreDir: process.env[SECRET_STORE_DIR_ENV],
  allowLocalMasterKey: process.env[SECRET_STORE_ALLOW_LOCAL_MASTER_KEY_ENV],
  apiKey: process.env.SMARTPERFETTO_API_KEY,
};

describe('Provider Routes', () => {
  let app: express.Express;
  let dir: string;

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `provider-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fsp.mkdir(dir, { recursive: true });
    process.env.PROVIDER_DATA_DIR_OVERRIDE = dir;
    resetProviderService();

    const { default: providerRoutes } = await import('../../../routes/providerRoutes');
    app = express();
    app.use(express.json());
    app.use('/api/v1/providers', providerRoutes);
  });

  afterEach(async () => {
    delete process.env.PROVIDER_DATA_DIR_OVERRIDE;
    restoreEnvValue(ENTERPRISE_FEATURE_FLAG_ENV, originalEnv.enterprise);
    restoreEnvValue('SMARTPERFETTO_SSO_TRUSTED_HEADERS', originalEnv.trustedHeaders);
    restoreEnvValue(ENTERPRISE_DB_PATH_ENV, originalEnv.enterpriseDbPath);
    restoreEnvValue(SECRET_STORE_DIR_ENV, originalEnv.secretStoreDir);
    restoreEnvValue(SECRET_STORE_ALLOW_LOCAL_MASTER_KEY_ENV, originalEnv.allowLocalMasterKey);
    restoreEnvValue('SMARTPERFETTO_API_KEY', originalEnv.apiKey);
    resetProviderService();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  function restoreEnvValue(key: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  function ssoHeaders(
    req: request.Test,
    input: {
      userId?: string;
      role?: string;
      scopes?: string;
    } = {},
  ): request.Test {
    const userId = input.userId ?? 'provider-admin';
    return req
      .set('X-SmartPerfetto-SSO-User-Id', userId)
      .set('X-SmartPerfetto-SSO-Email', `${userId}@example.test`)
      .set('X-SmartPerfetto-SSO-Tenant-Id', 'tenant-a')
      .set('X-SmartPerfetto-SSO-Workspace-Id', 'workspace-a')
      .set('X-SmartPerfetto-SSO-Roles', input.role ?? 'workspace_admin')
      .set('X-SmartPerfetto-SSO-Scopes', input.scopes ?? 'provider:write,audit:read');
  }

  function readEnterpriseAuditActions(dbPath: string): string[] {
    const db = openEnterpriseDb(dbPath);
    try {
      return listEnterpriseAuditEvents(db).map(event => event.action);
    } finally {
      db.close();
    }
  }

  it('GET /api/v1/providers returns empty list initially', async () => {
    const res = await request(app).get('/api/v1/providers');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.providers).toEqual([]);
  });

  it('GET /api/v1/providers/templates returns official templates', async () => {
    const res = await request(app).get('/api/v1/providers/templates');
    expect(res.status).toBe(200);
    expect(res.body.templates.length).toBeGreaterThan(0);
    expect(res.body.templates[0].type).toBe('anthropic');
    const xiaomi = res.body.templates.find((template: { type: string }) => template.type === 'xiaomi');
    expect(xiaomi.defaultConnection.claudeBaseUrl).toBe('https://token-plan-sgp.xiaomimimo.com/anthropic');
    expect(xiaomi.defaultConnection.openaiBaseUrl).toBe('https://token-plan-sgp.xiaomimimo.com/v1');
  });

  it('requires provider management permission for provider access in enterprise SSO', async () => {
    process.env[ENTERPRISE_FEATURE_FLAG_ENV] = 'true';
    process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS = 'true';
    delete process.env.SMARTPERFETTO_API_KEY;

    const analystRes = await ssoHeaders(
      request(app).get('/api/v1/providers'),
      { userId: 'provider-analyst', role: 'analyst', scopes: 'trace:read,report:read' },
    );
    expect(analystRes.status).toBe(403);
    expect(analystRes.body.details).toContain('Provider management requires provider:manage_workspace permission');

    const adminRes = await ssoHeaders(request(app).get('/api/v1/providers/templates'));
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.success).toBe(true);
  });

  it('POST + GET + DELETE lifecycle', async () => {
    const createRes = await request(app).post('/api/v1/providers').send({
      name: 'Test',
      category: 'official',
      type: 'anthropic',
      models: { primary: 'claude-sonnet-4-6', light: 'claude-haiku-4-5' },
      connection: { apiKey: 'sk-test-key-12345678' },
    });
    expect(createRes.status).toBe(201);
    const id = createRes.body.provider.id;

    const getRes = await request(app).get(`/api/v1/providers/${id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.provider.connection.apiKey).toMatch(/^\*{4}/);

    const deleteRes = await request(app).delete(`/api/v1/providers/${id}`);
    expect(deleteRes.status).toBe(200);
  });

  it('POST /:id/activate sets active', async () => {
    const createRes = await request(app).post('/api/v1/providers').send({
      name: 'Activate Me',
      category: 'official',
      type: 'bedrock',
      models: { primary: 'claude-sonnet-4-6', light: 'claude-haiku-4-5' },
      connection: { awsRegion: 'us-east-1', awsBearerToken: 'tok' },
    });
    const id = createRes.body.provider.id;

    const activateRes = await request(app).post(`/api/v1/providers/${id}/activate`);
    expect(activateRes.status).toBe(200);

    const effectiveRes = await request(app).get('/api/v1/providers/effective');
    expect(effectiveRes.body.source).toBe('provider-manager');
  });

  it('POST /:id/runtime switches provider SDK runtime', async () => {
    const createRes = await request(app).post('/api/v1/providers').send({
      name: 'DeepSeek Dual',
      category: 'official',
      type: 'deepseek',
      models: { primary: 'deepseek-v4-pro', light: 'deepseek-v4-flash' },
      connection: {
        apiKey: 'sk-deepseek-test',
        agentRuntime: 'claude-agent-sdk',
        claudeBaseUrl: 'https://api.deepseek.com/anthropic',
        openaiBaseUrl: 'https://api.deepseek.com/v1',
      },
    });
    const id = createRes.body.provider.id;

    const runtimeRes = await request(app)
      .post(`/api/v1/providers/${id}/runtime`)
      .send({ agentRuntime: 'openai-agents-sdk' });

    expect(runtimeRes.status).toBe(200);
    expect(runtimeRes.body.provider.connection.agentRuntime).toBe('openai-agents-sdk');
  });

  it('POST /:id/runtime rejects unsupported SDK runtime for provider type', async () => {
    const createRes = await request(app).post('/api/v1/providers').send({
      name: 'Anthropic Only',
      category: 'official',
      type: 'anthropic',
      models: { primary: 'claude-sonnet-4-6', light: 'claude-haiku-4-5' },
      connection: { claudeApiKey: 'sk-test-key-12345678' },
    });
    const id = createRes.body.provider.id;

    const runtimeRes = await request(app)
      .post(`/api/v1/providers/${id}/runtime`)
      .send({ agentRuntime: 'openai-agents-sdk' });

    expect(runtimeRes.status).toBe(400);
    expect(runtimeRes.body.error).toMatch(/does not support openai-agents-sdk/);
  });

  it('records enterprise audit events for provider management actions', async () => {
    const dbPath = path.join(dir, 'enterprise.sqlite');
    process.env[ENTERPRISE_FEATURE_FLAG_ENV] = 'true';
    process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS = 'true';
    process.env[ENTERPRISE_DB_PATH_ENV] = dbPath;
    process.env[SECRET_STORE_DIR_ENV] = path.join(dir, 'secrets');
    process.env[SECRET_STORE_ALLOW_LOCAL_MASTER_KEY_ENV] = 'true';
    delete process.env.SMARTPERFETTO_API_KEY;
    resetProviderService();

    const createRes = await ssoHeaders(request(app).post('/api/v1/providers')).send({
      name: 'Audited DeepSeek',
      category: 'official',
      type: 'deepseek',
      models: { primary: 'deepseek-v4-pro', light: 'deepseek-v4-flash' },
      connection: {
        apiKey: 'sk-deepseek-audit',
        agentRuntime: 'claude-agent-sdk',
        claudeBaseUrl: 'https://api.deepseek.com/anthropic',
        openaiBaseUrl: 'https://api.deepseek.com/v1',
      },
    });
    expect(createRes.status).toBe(201);
    const id = createRes.body.provider.id;

    expect(await ssoHeaders(request(app).get(`/api/v1/providers/${id}`))).toHaveProperty('status', 200);
    expect(await ssoHeaders(request(app).patch(`/api/v1/providers/${id}`)).send({
      name: 'Audited DeepSeek Updated',
    })).toHaveProperty('status', 200);
    expect(await ssoHeaders(request(app).post(`/api/v1/providers/${id}/activate`))).toHaveProperty('status', 200);
    expect(await ssoHeaders(request(app).post(`/api/v1/providers/${id}/runtime`)).send({
      agentRuntime: 'openai-agents-sdk',
    })).toHaveProperty('status', 200);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    try {
      expect(await ssoHeaders(request(app).post(`/api/v1/providers/${id}/test`))).toHaveProperty('status', 200);
    } finally {
      fetchSpy.mockRestore();
    }
    expect(await ssoHeaders(request(app).post(`/api/v1/providers/${id}/rotate-secret`))).toHaveProperty('status', 200);
    expect(await ssoHeaders(request(app).post('/api/v1/providers/deactivate'))).toHaveProperty('status', 200);
    expect(await ssoHeaders(request(app).delete(`/api/v1/providers/${id}`))).toHaveProperty('status', 200);

    expect(readEnterpriseAuditActions(dbPath)).toEqual(expect.arrayContaining([
      'provider.created',
      'provider.read',
      'provider.updated',
      'provider.activated',
      'provider.runtime_switched',
      'provider.connection_tested',
      'provider.secret_rotated',
      'provider.deactivated',
      'provider.deleted',
    ]));
  });
});
