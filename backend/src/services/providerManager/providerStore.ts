// backend/src/services/providerManager/providerStore.ts
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import { openEnterpriseDb } from '../enterpriseDb';
import {
  enterpriseDbReadAuthorityEnabled,
  enterpriseDbWritesEnabled,
  legacyFilesystemWritesEnabled,
} from '../enterpriseMigration';
import { recordEnterpriseAuditEvent } from '../enterpriseAuditService';
import type { ProviderConfig, ProviderConnection, ProviderScope } from './types';
import { LocalEncryptedSecretStore } from './localSecretStore';

type ProviderCredentialScope = 'personal' | 'workspace' | 'org';

interface ProviderCredentialRow {
  id: string;
  tenant_id: string;
  workspace_id: string | null;
  owner_user_id: string | null;
  scope: ProviderCredentialScope;
  name: string;
  type: ProviderConfig['type'];
  models_json: string;
  secret_ref: string;
  policy_json: string | null;
  created_at: number;
  updated_at: number;
}

interface ProviderPolicyJson {
  category?: ProviderConfig['category'];
  isActive?: boolean;
  connection?: ProviderConnection;
  tuning?: ProviderConfig['tuning'];
  custom?: ProviderConfig['custom'];
  secretVersion?: number;
}

const DEFAULT_PROVIDER_SCOPE: Required<ProviderScope> = {
  tenantId: 'default-dev-tenant',
  workspaceId: 'default-workspace',
  userId: 'dev-user-123',
};

const SAFE_PROVIDER_SCOPE_RE = /^[a-zA-Z0-9._:-]+$/;
const SENSITIVE_CONNECTION_FIELDS: Array<keyof ProviderConnection> = [
  'apiKey',
  'claudeApiKey',
  'claudeAuthToken',
  'openaiApiKey',
  'awsBearerToken',
  'awsAccessKeyId',
  'awsSecretAccessKey',
  'awsSessionToken',
];

function enterpriseProviderStoreEnabled(): boolean {
  return enterpriseDbReadAuthorityEnabled();
}

function enterpriseProviderDbWritesEnabled(): boolean {
  return enterpriseDbWritesEnabled();
}

function legacyProviderWritesEnabled(): boolean {
  return legacyFilesystemWritesEnabled();
}

function assertSafeScopeSegment(value: string, label: string): string {
  if (!SAFE_PROVIDER_SCOPE_RE.test(value) || value === '.' || value === '..') {
    throw new Error(`Unsafe provider ${label}: ${value}`);
  }
  return value;
}

function resolveProviderScope(scope?: ProviderScope): Required<ProviderScope> {
  return {
    tenantId: assertSafeScopeSegment(scope?.tenantId || DEFAULT_PROVIDER_SCOPE.tenantId, 'tenant id'),
    workspaceId: assertSafeScopeSegment(scope?.workspaceId || DEFAULT_PROVIDER_SCOPE.workspaceId, 'workspace id'),
    userId: assertSafeScopeSegment(scope?.userId || DEFAULT_PROVIDER_SCOPE.userId, 'user id'),
  };
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function toEpochMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function toIsoString(value: number): string {
  return new Date(value).toISOString();
}

function splitConnectionSecrets(connection: ProviderConnection): {
  publicConnection: ProviderConnection;
  secretConnection: Record<string, string>;
} {
  const publicConnection: ProviderConnection = {};
  const secretConnection: Record<string, string> = {};
  for (const [key, value] of Object.entries(connection)) {
    if (value === undefined) continue;
    if (SENSITIVE_CONNECTION_FIELDS.includes(key as keyof ProviderConnection)) {
      if (typeof value === 'string' && value.length > 0) {
        secretConnection[key] = value;
      }
    } else {
      (publicConnection as Record<string, unknown>)[key] = value;
    }
  }
  return { publicConnection, secretConnection };
}

function mergeConnectionSecrets(
  publicConnection: ProviderConnection | undefined,
  secretConnection: Record<string, string>,
): ProviderConnection {
  return {
    ...(publicConnection ?? {}),
    ...secretConnection,
  };
}

function providerSecretRef(scope: Required<ProviderScope>, providerId: string): string {
  return `secret:provider:${scope.tenantId}:${scope.workspaceId}:${scope.userId}:${providerId}`;
}

function ensureEnterpriseProviderGraph(scope: Required<ProviderScope>): void {
  const now = Date.now();
  const db = openEnterpriseDb();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, status, plan, created_at, updated_at)
      VALUES (?, ?, 'active', 'enterprise', ?, ?)
    `).run(scope.tenantId, scope.tenantId, now, now);
    db.prepare(`
      INSERT OR IGNORE INTO workspaces (id, tenant_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(scope.workspaceId, scope.tenantId, scope.workspaceId, now, now);
    db.prepare(`
      INSERT INTO users (id, tenant_id, email, display_name, idp_subject, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        display_name = excluded.display_name,
        updated_at = excluded.updated_at
    `).run(
      scope.userId,
      scope.tenantId,
      `${scope.userId}@provider.local`,
      scope.userId,
      `provider:${scope.userId}`,
      now,
      now,
    );
  } finally {
    db.close();
  }
}

function accessibleProviderWhere(): string {
  return `
    tenant_id = @tenantId
    AND (
      (scope = 'personal' AND workspace_id = @workspaceId AND owner_user_id = @userId)
      OR (scope = 'workspace' AND workspace_id = @workspaceId AND owner_user_id IS NULL)
      OR (scope = 'org' AND workspace_id IS NULL AND owner_user_id IS NULL)
    )
  `;
}

export class ProviderStore {
  private providers = new Map<string, ProviderConfig>();
  private filePath: string;
  private secretStore?: LocalEncryptedSecretStore;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): void {
    if (enterpriseProviderStoreEnabled()) return;
    this.providers.clear();
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const arr: ProviderConfig[] = JSON.parse(raw);
      for (const p of arr) this.providers.set(p.id, p);
    } catch (err) {
      console.warn('[ProviderStore] Failed to load providers.json, starting fresh:', (err as Error).message);
    }
  }

  getAll(scope?: ProviderScope): ProviderConfig[] {
    if (enterpriseProviderStoreEnabled()) {
      return this.getAllEnterprise(scope);
    }
    return Array.from(this.providers.values());
  }

  get(id: string, scope?: ProviderScope): ProviderConfig | undefined {
    if (enterpriseProviderStoreEnabled()) {
      return this.getEnterprise(id, scope);
    }
    return this.providers.get(id);
  }

  getActive(scope?: ProviderScope): ProviderConfig | undefined {
    for (const p of this.getAll(scope)) {
      if (p.isActive) return p;
    }
    return undefined;
  }

  set(provider: ProviderConfig, scope?: ProviderScope): void {
    if (!enterpriseProviderStoreEnabled()) {
      this.providers.set(provider.id, provider);
      this.persist();
    }
    if (enterpriseProviderDbWritesEnabled()) {
      this.setEnterprise(provider, scope);
    }
  }

  delete(id: string, scope?: ProviderScope): boolean {
    let deleted = false;
    if (!enterpriseProviderStoreEnabled()) {
      deleted = this.providers.delete(id);
      if (deleted) this.persist();
    }
    if (enterpriseProviderDbWritesEnabled()) {
      deleted = this.deleteEnterprise(id, scope) || deleted;
    }
    return deleted;
  }

  rotateSecret(id: string, scope?: ProviderScope): number | undefined {
    if (!enterpriseProviderDbWritesEnabled()) return undefined;
    return this.rotateEnterpriseSecret(id, scope);
  }

  private getSecretStore(): LocalEncryptedSecretStore {
    if (!this.secretStore) {
      this.secretStore = new LocalEncryptedSecretStore();
    }
    return this.secretStore;
  }

  private getAllEnterprise(scope?: ProviderScope): ProviderConfig[] {
    const resolved = resolveProviderScope(scope);
    const db = openEnterpriseDb();
    try {
      const rows = db.prepare<unknown[], ProviderCredentialRow>(`
        SELECT *
        FROM provider_credentials
        WHERE ${accessibleProviderWhere()}
        ORDER BY
          CASE scope
            WHEN 'personal' THEN 0
            WHEN 'workspace' THEN 1
            ELSE 2
          END,
          updated_at DESC
      `).all(resolved);
      return rows
        .map(row => this.providerFromEnterpriseRow(row))
        .filter((provider): provider is ProviderConfig => Boolean(provider));
    } finally {
      db.close();
    }
  }

  private getEnterprise(id: string, scope?: ProviderScope): ProviderConfig | undefined {
    const resolved = resolveProviderScope(scope);
    const db = openEnterpriseDb();
    try {
      const row = db.prepare<unknown[], ProviderCredentialRow>(`
        SELECT *
        FROM provider_credentials
        WHERE id = @id AND ${accessibleProviderWhere()}
        LIMIT 1
      `).get({ ...resolved, id });
      return row ? this.providerFromEnterpriseRow(row) ?? undefined : undefined;
    } finally {
      db.close();
    }
  }

  private setEnterprise(provider: ProviderConfig, scope?: ProviderScope): void {
    const resolved = resolveProviderScope(scope);
    ensureEnterpriseProviderGraph(resolved);
    const existing = this.getEnterpriseRowById(provider.id, resolved);
    const effectiveScope = existing?.scope ?? (resolved.userId ? 'personal' : 'workspace');
    const workspaceId = effectiveScope === 'org' ? null : resolved.workspaceId;
    const ownerUserId = effectiveScope === 'personal' ? resolved.userId : null;
    const secretRef = existing?.secret_ref ?? providerSecretRef(resolved, provider.id);
    const { publicConnection, secretConnection } = splitConnectionSecrets(provider.connection);
    const secretVersion = this.getSecretStore().put(secretRef, secretConnection);
    const policy: ProviderPolicyJson = {
      category: provider.category,
      isActive: provider.isActive,
      connection: publicConnection,
      ...(provider.tuning ? { tuning: provider.tuning } : {}),
      ...(provider.custom ? { custom: provider.custom } : {}),
      secretVersion,
    };

    const db = openEnterpriseDb();
    try {
      db.prepare(`
        INSERT INTO provider_credentials
          (id, tenant_id, workspace_id, owner_user_id, scope, name, type, models_json, secret_ref, policy_json, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          workspace_id = excluded.workspace_id,
          owner_user_id = excluded.owner_user_id,
          scope = excluded.scope,
          name = excluded.name,
          type = excluded.type,
          models_json = excluded.models_json,
          secret_ref = excluded.secret_ref,
          policy_json = excluded.policy_json,
          updated_at = excluded.updated_at
      `).run(
        provider.id,
        resolved.tenantId,
        workspaceId,
        ownerUserId,
        effectiveScope,
        provider.name,
        provider.type,
        JSON.stringify(provider.models),
        secretRef,
        JSON.stringify(policy),
        existing?.created_at ?? toEpochMs(provider.createdAt),
        toEpochMs(provider.updatedAt),
      );
      this.recordProviderSecretAudit(db, {
        action: existing ? 'provider.secret.write' : 'provider.secret.create',
        row: {
          id: provider.id,
          tenant_id: resolved.tenantId,
          workspace_id: workspaceId,
          owner_user_id: ownerUserId,
          secret_ref: secretRef,
        },
        secretVersion,
      });
    } finally {
      db.close();
    }
  }

  private deleteEnterprise(id: string, scope?: ProviderScope): boolean {
    const resolved = resolveProviderScope(scope);
    const row = this.getEnterpriseRowById(id, resolved);
    if (!row) return false;
    const db = openEnterpriseDb();
    try {
      const result = db.prepare(`
        DELETE FROM provider_credentials
        WHERE id = @id AND ${accessibleProviderWhere()}
      `).run({ ...resolved, id });
      if (result.changes > 0) {
        this.getSecretStore().delete(row.secret_ref);
        this.recordProviderSecretAudit(db, {
          action: 'provider.secret.delete',
          row,
          secretVersion: this.readSecretVersionFromPolicy(row),
        });
      }
      return result.changes > 0;
    } finally {
      db.close();
    }
  }

  private rotateEnterpriseSecret(id: string, scope?: ProviderScope): number | undefined {
    const resolved = resolveProviderScope(scope);
    const row = this.getEnterpriseRowById(id, resolved);
    if (!row) return undefined;
    const secretVersion = this.getSecretStore().rotate(row.secret_ref);
    const policy = {
      ...parseJsonObject(row.policy_json),
      secretVersion,
    };
    const db = openEnterpriseDb();
    try {
      db.prepare(`
        UPDATE provider_credentials
        SET policy_json = @policyJson, updated_at = @updatedAt
        WHERE id = @id AND ${accessibleProviderWhere()}
      `).run({
        ...resolved,
        id,
        policyJson: JSON.stringify(policy),
        updatedAt: Date.now(),
      });
      this.recordProviderSecretAudit(db, {
        action: 'provider.secret.rotate',
        row,
        secretVersion,
      });
      return secretVersion;
    } finally {
      db.close();
    }
  }

  private getEnterpriseRowById(id: string, scope: Required<ProviderScope>): ProviderCredentialRow | undefined {
    const db = openEnterpriseDb();
    try {
      return db.prepare<unknown[], ProviderCredentialRow>(`
        SELECT *
        FROM provider_credentials
        WHERE id = @id AND ${accessibleProviderWhere()}
        LIMIT 1
      `).get({ ...scope, id });
    } finally {
      db.close();
    }
  }

  private providerFromEnterpriseRow(row: ProviderCredentialRow): ProviderConfig | null {
    const policy = parseJsonObject(row.policy_json) as ProviderPolicyJson;
    const models = parseJsonObject(row.models_json);
    if (typeof models.primary !== 'string' || typeof models.light !== 'string') {
      return null;
    }
    this.recordProviderSecretAudit(undefined, {
      action: 'provider.secret.read',
      row,
      secretVersion: policy.secretVersion,
    });
    const secretConnection = this.getSecretStore().get(row.secret_ref);
    const connection = mergeConnectionSecrets(policy.connection, secretConnection);
    return {
      id: row.id,
      name: row.name,
      category: policy.category ?? 'custom',
      type: row.type,
      isActive: policy.isActive === true,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
      models: {
        primary: models.primary,
        light: models.light,
        ...(typeof models.subAgent === 'string' ? { subAgent: models.subAgent } : {}),
      },
      connection,
      ...(policy.tuning ? { tuning: policy.tuning } : {}),
      ...(policy.custom ? { custom: policy.custom } : {}),
    };
  }

  private persist(): void {
    if (!legacyProviderWritesEnabled()) return;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.getAll(), null, 2));
    fs.renameSync(tmp, this.filePath);
    try { fs.chmodSync(this.filePath, 0o600); } catch { /* Windows */ }
  }

  private readSecretVersionFromPolicy(row: ProviderCredentialRow): number | undefined {
    const policy = parseJsonObject(row.policy_json) as ProviderPolicyJson;
    return policy.secretVersion;
  }

  private recordProviderSecretAudit(
    db: ReturnType<typeof openEnterpriseDb> | undefined,
    input: {
      action: string;
      row: Pick<ProviderCredentialRow, 'id' | 'tenant_id' | 'workspace_id' | 'owner_user_id' | 'secret_ref'>;
      secretVersion?: number;
    },
  ): void {
    const record = (targetDb: ReturnType<typeof openEnterpriseDb>) => {
      recordEnterpriseAuditEvent(targetDb, {
        tenantId: input.row.tenant_id,
        workspaceId: input.row.workspace_id ?? undefined,
        actorUserId: input.row.owner_user_id ?? undefined,
        action: input.action,
        resourceType: 'provider_secret',
        resourceId: input.row.id,
        metadata: {
          secretRefHash: hashSecretRef(input.row.secret_ref),
          secretVersion: input.secretVersion,
          secretStore: this.getSecretStore().info(),
        },
      });
    };
    try {
      if (db) {
        record(db);
        return;
      }
      const auditDb = openEnterpriseDb();
      try {
        record(auditDb);
      } finally {
        auditDb.close();
      }
    } catch (err) {
      console.warn('[ProviderStore] Failed to record provider secret audit:', (err as Error).message);
    }
  }
}

function hashSecretRef(secretRef: string): string {
  return `sha256:${crypto.createHash('sha256').update(secretRef).digest('hex')}`;
}
