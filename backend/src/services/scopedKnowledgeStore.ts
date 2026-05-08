// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import crypto from 'crypto';
import type Database from 'better-sqlite3';

import { resolveFeatureConfig } from '../config';
import type { RequestContext } from '../middleware/auth';
import { openEnterpriseDb } from './enterpriseDb';
import { createEnterpriseWorkspaceRepository } from './enterpriseRepository';

const DEFAULT_TENANT_ID = 'default-dev-tenant';
const DEFAULT_WORKSPACE_ID = 'default-workspace';
const DEFAULT_USER_ID = 'dev-user-123';
const SAFE_SCOPE_SEGMENT_RE = /^[a-zA-Z0-9._:-]+$/;

interface KnowledgeEntryRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  workspace_id: string;
  scope: string;
  source_run_id: string | null;
  content_json: string;
  embedding_ref: string | null;
  created_at: number;
  updated_at: number;
}

interface KnowledgeEnvelope<T> {
  schemaVersion: 1;
  kind: string;
  externalId: string;
  sourceTenantId: string;
  sourceWorkspaceId: string;
  sourceRunId?: string;
  record: T;
}

export interface KnowledgeScope {
  tenantId?: string;
  workspaceId?: string;
  userId?: string;
  sourceRunId?: string;
  runId?: string;
}

export interface ResolvedKnowledgeScope {
  tenantId: string;
  workspaceId: string;
  userId?: string;
  sourceRunId?: string;
}

export interface ScopedKnowledgeRecord<T> {
  externalId: string;
  rowScope: string;
  record: T;
  sourceRunId?: string;
  createdAt: number;
  updatedAt: number;
}

interface ListOptions {
  rowScope?: string;
  rowScopePrefix?: string;
  includeSystem?: boolean;
}

interface UpsertOptions {
  createdAt?: number;
  updatedAt?: number;
  sourceRunId?: string;
  embeddingRef?: string;
}

export function enterpriseKnowledgeStoreEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveFeatureConfig(env).enterprise;
}

export function knowledgeScopeFromRequestContext(
  context: RequestContext,
): KnowledgeScope {
  return {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    userId: context.userId,
  };
}

export function resolveKnowledgeScope(
  scope: KnowledgeScope = {},
): ResolvedKnowledgeScope {
  const tenantId = sanitizeScopeSegment(
    scope.tenantId || DEFAULT_TENANT_ID,
    'tenantId',
  );
  const workspaceId = sanitizeScopeSegment(
    scope.workspaceId || DEFAULT_WORKSPACE_ID,
    'workspaceId',
  );
  const userId = scope.userId
    ? sanitizeScopeSegment(scope.userId, 'userId')
    : DEFAULT_USER_ID;
  const sourceRunId = scope.sourceRunId || scope.runId;
  return {
    tenantId,
    workspaceId,
    ...(userId ? {userId} : {}),
    ...(sourceRunId
      ? {sourceRunId: sanitizeScopeSegment(sourceRunId, 'sourceRunId')}
      : {}),
  };
}

export function scopedKnowledgeRowId(
  kind: string,
  externalId: string,
  scope: Pick<ResolvedKnowledgeScope, 'tenantId' | 'workspaceId'>,
): string {
  const digest = crypto
    .createHash('sha256')
    .update(`${scope.tenantId}\0${scope.workspaceId}\0${kind}\0${externalId}`)
    .digest('hex')
    .slice(0, 32);
  return `knowledge-${digest}`;
}

export function upsertScopedKnowledgeRecord<T>(
  kind: string,
  externalId: string,
  rowScope: string,
  record: T,
  scopeInput?: KnowledgeScope,
  opts: UpsertOptions = {},
): void {
  const scope = resolveKnowledgeScope(scopeInput);
  const now = Date.now();
  const createdAt = opts.createdAt ?? now;
  const updatedAt = opts.updatedAt ?? now;
  withKnowledgeDb((db) => {
    const tx = db.transaction(() => {
      ensureEnterpriseKnowledgeGraph(db, scope);
      const sourceRunId = resolveSourceRunId(db, opts.sourceRunId || scope.sourceRunId);
      const envelope: KnowledgeEnvelope<T> = {
        schemaVersion: 1,
        kind,
        externalId,
        sourceTenantId: scope.tenantId,
        sourceWorkspaceId: scope.workspaceId,
        ...(sourceRunId ? {sourceRunId} : {}),
        record,
      };
      db.prepare(`
        INSERT INTO memory_entries
          (id, tenant_id, workspace_id, scope, source_run_id, content_json, embedding_ref, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          workspace_id = excluded.workspace_id,
          scope = excluded.scope,
          source_run_id = excluded.source_run_id,
          content_json = excluded.content_json,
          embedding_ref = excluded.embedding_ref,
          updated_at = excluded.updated_at
      `).run(
        scopedKnowledgeRowId(kind, externalId, scope),
        scope.tenantId,
        scope.workspaceId,
        rowScope,
        sourceRunId,
        JSON.stringify(envelope),
        opts.embeddingRef ?? null,
        createdAt,
        updatedAt,
      );
    });
    tx();
  });
}

export function getScopedKnowledgeRecord<T>(
  kind: string,
  externalId: string,
  scopeInput?: KnowledgeScope,
): ScopedKnowledgeRecord<T> | undefined {
  const scope = resolveKnowledgeScope(scopeInput);
  return withKnowledgeDb((db) => {
    const repo = createEnterpriseWorkspaceRepository<KnowledgeEntryRow>(
      db,
      'memory_entries',
    );
    const row = repo.getById(
      scope,
      scopedKnowledgeRowId(kind, externalId, scope),
    );
    return row ? parseKnowledgeRow<T>(kind, row) : undefined;
  });
}

export function removeScopedKnowledgeRecord(
  kind: string,
  externalId: string,
  scopeInput?: KnowledgeScope,
): boolean {
  const scope = resolveKnowledgeScope(scopeInput);
  return withKnowledgeDb((db) => {
    const repo = createEnterpriseWorkspaceRepository<KnowledgeEntryRow>(
      db,
      'memory_entries',
    );
    return repo.deleteById(
      scope,
      scopedKnowledgeRowId(kind, externalId, scope),
    ) > 0;
  });
}

export function listScopedKnowledgeRecords<T>(
  kind: string,
  scopeInput?: KnowledgeScope,
  opts: ListOptions = {},
): ScopedKnowledgeRecord<T>[] {
  const scope = resolveKnowledgeScope(scopeInput);
  return withKnowledgeDb((db) => {
    const params: Record<string, string> = {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      systemTenantId: 'system',
      systemWorkspaceId: 'system',
    };
    const ownerClause = opts.includeSystem
      ? `((tenant_id = @tenantId AND workspace_id = @workspaceId)
          OR (tenant_id = @systemTenantId AND workspace_id = @systemWorkspaceId))`
      : `(tenant_id = @tenantId AND workspace_id = @workspaceId)`;
    let scopeClause = '';
    if (opts.rowScope !== undefined) {
      params.rowScope = opts.rowScope;
      scopeClause = 'AND scope = @rowScope';
    } else if (opts.rowScopePrefix !== undefined) {
      params.rowScopePrefix = `${opts.rowScopePrefix}%`;
      scopeClause = 'AND scope LIKE @rowScopePrefix';
    }
    const rows = db.prepare<unknown[], KnowledgeEntryRow>(`
      SELECT *
      FROM memory_entries
      WHERE ${ownerClause}
        ${scopeClause}
      ORDER BY updated_at DESC, id ASC
    `).all(params);
    return rows
      .map(row => parseKnowledgeRow<T>(kind, row))
      .filter((record): record is ScopedKnowledgeRecord<T> => Boolean(record));
  });
}

function withKnowledgeDb<T>(fn: (db: Database.Database) => T): T {
  const db = openEnterpriseDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function sanitizeScopeSegment(value: string, label: string): string {
  if (!SAFE_SCOPE_SEGMENT_RE.test(value) || value === '.' || value === '..') {
    throw new Error(`Unsafe knowledge ${label}: ${value}`);
  }
  return value;
}

function ensureEnterpriseKnowledgeGraph(
  db: Database.Database,
  scope: ResolvedKnowledgeScope,
): void {
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, status, plan, created_at, updated_at)
    VALUES (?, ?, 'active', 'enterprise', ?, ?)
  `).run(scope.tenantId, scope.tenantId, now, now);
  db.prepare(`
    INSERT OR IGNORE INTO workspaces (id, tenant_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(scope.workspaceId, scope.tenantId, scope.workspaceId, now, now);
  if (scope.userId) {
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
      `${scope.userId}@knowledge.local`,
      scope.userId,
      `knowledge:${scope.userId}`,
      now,
      now,
    );
  }
}

function resolveSourceRunId(
  db: Database.Database,
  sourceRunId?: string,
): string | null {
  if (!sourceRunId) return null;
  const row = db.prepare<unknown[], {id: string}>(`
    SELECT id
    FROM analysis_runs
    WHERE id = ?
    LIMIT 1
  `).get(sourceRunId);
  return row ? sourceRunId : null;
}

function parseKnowledgeRow<T>(
  kind: string,
  row: KnowledgeEntryRow,
): ScopedKnowledgeRecord<T> | undefined {
  try {
    const parsed = JSON.parse(row.content_json) as KnowledgeEnvelope<T>;
    if (
      parsed.schemaVersion !== 1 ||
      parsed.kind !== kind ||
      parsed.externalId === undefined
    ) {
      return undefined;
    }
    return {
      externalId: parsed.externalId,
      rowScope: row.scope,
      record: parsed.record,
      ...(row.source_run_id ? {sourceRunId: row.source_run_id} : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    return undefined;
  }
}
