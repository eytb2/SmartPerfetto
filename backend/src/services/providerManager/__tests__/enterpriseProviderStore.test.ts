// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ENTERPRISE_FEATURE_FLAG_ENV } from '../../../config';
import { ENTERPRISE_DB_PATH_ENV, openEnterpriseDb } from '../../enterpriseDb';
import { listEnterpriseAuditEvents } from '../../enterpriseAuditService';
import {
  SECRET_STORE_DIR_ENV,
  SECRET_STORE_MASTER_KEY_ENV,
} from '../localSecretStore';
import { ProviderService } from '../providerService';
import type { ProviderCreateInput, ProviderScope } from '../types';

const originalEnv = {
  enterprise: process.env[ENTERPRISE_FEATURE_FLAG_ENV],
  enterpriseDbPath: process.env[ENTERPRISE_DB_PATH_ENV],
  secretStoreDir: process.env[SECRET_STORE_DIR_ENV],
  secretStoreMasterKey: process.env[SECRET_STORE_MASTER_KEY_ENV],
};

interface ProviderCredentialRow {
  id: string;
  tenant_id: string;
  workspace_id: string | null;
  owner_user_id: string | null;
  scope: string;
  models_json: string;
  secret_ref: string;
  policy_json: string;
}

let tmpDir: string | undefined;
let dbPath: string;
let secretDir: string;
let svc: ProviderService;

const input: ProviderCreateInput = {
  name: 'Enterprise OpenAI',
  category: 'official',
  type: 'openai',
  models: { primary: 'gpt-5.5', light: 'gpt-5.4-mini' },
  connection: {
    openaiApiKey: 'sk-enterprise-secret-a',
    openaiBaseUrl: 'https://api.openai.com/v1',
  },
};

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function scope(userId: string): ProviderScope {
  return {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    userId,
  };
}

function workspaceScope(): ProviderScope {
  return {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
  };
}

function readProviderRows(): ProviderCredentialRow[] {
  const db = openEnterpriseDb(dbPath);
  try {
    return db.prepare<unknown[], ProviderCredentialRow>(`
      SELECT *
      FROM provider_credentials
      ORDER BY owner_user_id
    `).all();
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-enterprise-provider-store-'));
  dbPath = path.join(tmpDir, 'enterprise.sqlite');
  secretDir = path.join(tmpDir, 'secrets');
  process.env[ENTERPRISE_FEATURE_FLAG_ENV] = 'true';
  process.env[ENTERPRISE_DB_PATH_ENV] = dbPath;
  process.env[SECRET_STORE_DIR_ENV] = secretDir;
  process.env[SECRET_STORE_MASTER_KEY_ENV] = Buffer.alloc(32, 3).toString('base64');
  svc = new ProviderService(path.join(tmpDir, 'providers.json'));
});

afterEach(async () => {
  restoreEnvValue(ENTERPRISE_FEATURE_FLAG_ENV, originalEnv.enterprise);
  restoreEnvValue(ENTERPRISE_DB_PATH_ENV, originalEnv.enterpriseDbPath);
  restoreEnvValue(SECRET_STORE_DIR_ENV, originalEnv.secretStoreDir);
  restoreEnvValue(SECRET_STORE_MASTER_KEY_ENV, originalEnv.secretStoreMasterKey);
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe('enterprise provider store', () => {
  it('stores provider metadata in DB and encrypted secrets outside provider_credentials', async () => {
    const provider = svc.create(input, scope('user-a'));
    svc.activate(provider.id, scope('user-a'));

    const row = readProviderRows()[0];
    expect(row).toEqual(expect.objectContaining({
      id: provider.id,
      tenant_id: 'tenant-a',
      workspace_id: 'workspace-a',
      owner_user_id: 'user-a',
      scope: 'personal',
    }));
    expect(row.models_json).toContain('gpt-5.5');
    expect(row.policy_json).toContain('openaiBaseUrl');
    expect(row.policy_json).not.toContain('sk-enterprise-secret-a');
    expect(row.secret_ref).toMatch(/^secret:provider:/);
    expect(JSON.parse(row.policy_json).secretVersion).toBe(2);

    const providerJsonPath = path.join(tmpDir!, 'providers.json');
    await expect(fs.access(providerJsonPath)).rejects.toBeTruthy();

    const secretFile = await fs.readFile(path.join(secretDir, 'provider-secrets.enc.json'), 'utf-8');
    expect(secretFile).toContain('libsodium-secretbox');
    expect(secretFile).not.toContain('sk-enterprise-secret-a');
    expect(svc.getEnvForProvider(provider.id, scope('user-a'))!.OPENAI_API_KEY)
      .toBe('sk-enterprise-secret-a');
  });

  it('keeps personal provider activation isolated by user scope', () => {
    const providerA = svc.create({
      ...input,
      name: 'Provider A',
      connection: { openaiApiKey: 'sk-user-a' },
    }, scope('user-a'));
    svc.activate(providerA.id, scope('user-a'));

    const providerB = svc.create({
      ...input,
      name: 'Provider B',
      connection: { openaiApiKey: 'sk-user-b' },
    }, scope('user-b'));
    svc.activate(providerB.id, scope('user-b'));

    expect(svc.list(scope('user-a')).map(provider => provider.id)).toEqual([providerA.id]);
    expect(svc.list(scope('user-b')).map(provider => provider.id)).toEqual([providerB.id]);
    expect(svc.getEffectiveEnv(scope('user-a'))!.OPENAI_API_KEY).toBe('sk-user-a');
    expect(svc.getEffectiveEnv(scope('user-b'))!.OPENAI_API_KEY).toBe('sk-user-b');
  });

  it('keeps workspace default active when a user activates a personal provider', () => {
    const workspaceProvider = svc.create({
      ...input,
      name: 'Workspace Default',
      connection: { openaiApiKey: 'sk-workspace-default' },
    }, workspaceScope());
    svc.activate(workspaceProvider.id, workspaceScope());

    expect(svc.getEffectiveEnv(scope('user-a'))!.OPENAI_API_KEY).toBe('sk-workspace-default');
    expect(svc.getEffectiveEnv(scope('user-b'))!.OPENAI_API_KEY).toBe('sk-workspace-default');

    const personalProvider = svc.create({
      ...input,
      name: 'User A Provider',
      connection: { openaiApiKey: 'sk-user-a-default' },
    }, scope('user-a'));
    svc.activate(personalProvider.id, scope('user-a'));

    expect(svc.getEffectiveEnv(scope('user-a'))!.OPENAI_API_KEY).toBe('sk-user-a-default');
    expect(svc.getEffectiveEnv(scope('user-b'))!.OPENAI_API_KEY).toBe('sk-workspace-default');

    const rows = readProviderRows();
    const workspaceRow = rows.find(row => row.id === workspaceProvider.id);
    const personalRow = rows.find(row => row.id === personalProvider.id);
    expect(workspaceRow).toEqual(expect.objectContaining({
      owner_user_id: null,
      scope: 'workspace',
    }));
    expect(workspaceRow?.secret_ref).toContain(':_workspace:');
    expect(JSON.parse(workspaceRow!.policy_json).isActive).toBe(true);
    expect(personalRow).toEqual(expect.objectContaining({
      owner_user_id: 'user-a',
      scope: 'personal',
    }));
    expect(JSON.parse(personalRow!.policy_json).isActive).toBe(true);
  });

  it('rotates provider secrets and audits secret lifecycle operations', () => {
    const provider = svc.create(input, scope('user-a'));
    expect(svc.getEnvForProvider(provider.id, scope('user-a'))!.OPENAI_API_KEY)
      .toBe('sk-enterprise-secret-a');

    expect(svc.rotateSecret(provider.id, scope('user-a'))).toBe(2);
    expect(svc.getEnvForProvider(provider.id, scope('user-a'))!.OPENAI_API_KEY)
      .toBe('sk-enterprise-secret-a');

    const row = readProviderRows()[0];
    expect(JSON.parse(row.policy_json).secretVersion).toBe(2);

    const db = openEnterpriseDb(dbPath);
    try {
      const actions = listEnterpriseAuditEvents(db)
        .filter(event => event.resource_type === 'provider_secret')
        .map(event => event.action);
      expect(actions).toEqual(expect.arrayContaining([
        'provider.secret.create',
        'provider.secret.read',
        'provider.secret.rotate',
      ]));
    } finally {
      db.close();
    }
  });
});
