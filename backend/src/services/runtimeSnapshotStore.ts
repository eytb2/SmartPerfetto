// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { openEnterpriseDb } from './enterpriseDb';
import { createEnterpriseWorkspaceRepository } from './enterpriseRepository';

export const CLAUDE_SESSION_MAP_RUNTIME_TYPE = 'claude-session-map';

const SAFE_RUNTIME_ID_RE = /^[a-zA-Z0-9._:-]+$/;

export interface ClaudeSessionMapRuntimeEntry {
  sdkSessionId: string;
  updatedAt: number;
}

export interface RuntimeSnapshotScope {
  tenantId: string;
  workspaceId: string;
  userId?: string;
  sessionId: string;
  runId?: string;
  traceId?: string;
}

interface RuntimeSnapshotRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  runtime_type: string;
  snapshot_json: string;
  created_at: number;
}

interface ClaudeSessionMapSnapshotJson {
  sessionMapKey?: unknown;
  sdkSessionId?: unknown;
  updatedAt?: unknown;
  traceId?: unknown;
}

function assertSafeRuntimeId(value: string, label: string): string {
  if (!SAFE_RUNTIME_ID_RE.test(value) || value === '.' || value === '..') {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  return value;
}

function fallbackTraceId(scope: RuntimeSnapshotScope): string {
  return scope.traceId || `trace-${scope.sessionId}-runtime-snapshot`;
}

function fallbackRunId(scope: RuntimeSnapshotScope): string {
  return scope.runId || `run-${scope.sessionId}-runtime-snapshot`;
}

function runtimeSnapshotId(tenantId: string, workspaceId: string, sessionMapKey: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(`${tenantId}\0${workspaceId}\0${sessionMapKey}`)
    .digest('hex')
    .slice(0, 32);
  return `claude-session-map-${digest}`;
}

function withRuntimeSnapshotDb<T>(fn: (db: Database.Database) => T): T {
  const db = openEnterpriseDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function parseSnapshotJson(row: RuntimeSnapshotRow): [string, ClaudeSessionMapRuntimeEntry] | null {
  try {
    const parsed = JSON.parse(row.snapshot_json) as ClaudeSessionMapSnapshotJson;
    if (typeof parsed.sessionMapKey !== 'string' || typeof parsed.sdkSessionId !== 'string') {
      return null;
    }
    const updatedAt = typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
      ? parsed.updatedAt
      : row.created_at;
    return [parsed.sessionMapKey, { sdkSessionId: parsed.sdkSessionId, updatedAt }];
  } catch {
    return null;
  }
}

function ensureRuntimeSnapshotGraph(
  db: Database.Database,
  scope: RuntimeSnapshotScope,
): { tenantId: string; workspaceId: string; userId: string | null; sessionId: string; traceId: string; runId: string } {
  const tenantId = assertSafeRuntimeId(scope.tenantId, 'tenant id');
  const workspaceId = assertSafeRuntimeId(scope.workspaceId, 'workspace id');
  const sessionId = assertSafeRuntimeId(scope.sessionId, 'session id');
  const userId = scope.userId ? assertSafeRuntimeId(scope.userId, 'user id') : null;
  const traceId = assertSafeRuntimeId(fallbackTraceId(scope), 'trace id');
  const runId = assertSafeRuntimeId(fallbackRunId(scope), 'run id');
  const now = Date.now();

  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, status, plan, created_at, updated_at)
    VALUES (?, ?, 'active', 'enterprise', ?, ?)
  `).run(tenantId, tenantId, now, now);
  db.prepare(`
    INSERT OR IGNORE INTO workspaces (id, tenant_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(workspaceId, tenantId, workspaceId, now, now);
  if (userId) {
    db.prepare(`
      INSERT INTO users (id, tenant_id, email, display_name, idp_subject, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        display_name = excluded.display_name,
        updated_at = excluded.updated_at
    `).run(
      userId,
      tenantId,
      `${userId}@runtime.local`,
      userId,
      `runtime:${userId}`,
      now,
      now,
    );
  }
  db.prepare(`
    INSERT OR IGNORE INTO trace_assets
      (id, tenant_id, workspace_id, owner_user_id, local_path, size_bytes, status, metadata_json, created_at)
    VALUES
      (?, ?, ?, ?, ?, 0, 'metadata_only', ?, ?)
  `).run(
    traceId,
    tenantId,
    workspaceId,
    userId,
    `metadata-only:${traceId}`,
    JSON.stringify({ source: 'runtime_snapshot', sessionId }),
    now,
  );
  db.prepare(`
    INSERT OR IGNORE INTO analysis_sessions
      (id, tenant_id, workspace_id, trace_id, created_by, title, visibility, status, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, 'private', 'running', ?, ?)
  `).run(
    sessionId,
    tenantId,
    workspaceId,
    traceId,
    userId,
    `Runtime ${sessionId}`,
    now,
    now,
  );
  db.prepare(`
    INSERT OR IGNORE INTO analysis_runs
      (id, tenant_id, workspace_id, session_id, mode, status, question, started_at, completed_at)
    VALUES
      (?, ?, ?, ?, 'agent', 'running', '', ?, NULL)
  `).run(
    runId,
    tenantId,
    workspaceId,
    sessionId,
    now,
  );

  return { tenantId, workspaceId, userId, sessionId, traceId, runId };
}

export function loadClaudeSessionMapFromRuntimeSnapshots(
  maxAgeMs: number,
  now: number = Date.now(),
): Map<string, ClaudeSessionMapRuntimeEntry> {
  return withRuntimeSnapshotDb((db) => {
    const rows = db.prepare<unknown[], RuntimeSnapshotRow>(`
      SELECT *
      FROM runtime_snapshots
      WHERE runtime_type = ?
      ORDER BY created_at ASC
    `).all(CLAUDE_SESSION_MAP_RUNTIME_TYPE);

    const map = new Map<string, ClaudeSessionMapRuntimeEntry>();
    for (const row of rows) {
      const parsed = parseSnapshotJson(row);
      if (!parsed) continue;
      const [sessionMapKey, entry] = parsed;
      if (now - entry.updatedAt > maxAgeMs) continue;
      map.set(sessionMapKey, entry);
    }
    return map;
  });
}

export function saveClaudeSessionMapToRuntimeSnapshots(
  scope: RuntimeSnapshotScope,
  sessionMapKey: string,
  entry: ClaudeSessionMapRuntimeEntry,
): void {
  withRuntimeSnapshotDb((db) => {
    const write = db.transaction(() => {
      const graph = ensureRuntimeSnapshotGraph(db, scope);
      const id = runtimeSnapshotId(graph.tenantId, graph.workspaceId, sessionMapKey);
      const snapshotJson = JSON.stringify({
        sessionMapKey,
        sdkSessionId: entry.sdkSessionId,
        updatedAt: entry.updatedAt,
        traceId: graph.traceId,
      });

      db.prepare(`
        INSERT INTO runtime_snapshots
          (id, tenant_id, workspace_id, session_id, run_id, runtime_type, snapshot_json, created_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          workspace_id = excluded.workspace_id,
          session_id = excluded.session_id,
          run_id = excluded.run_id,
          runtime_type = excluded.runtime_type,
          snapshot_json = excluded.snapshot_json,
          created_at = excluded.created_at
      `).run(
        id,
        graph.tenantId,
        graph.workspaceId,
        graph.sessionId,
        graph.runId,
        CLAUDE_SESSION_MAP_RUNTIME_TYPE,
        snapshotJson,
        entry.updatedAt,
      );
    });
    write();
  });
}

export function deleteClaudeSessionMapRuntimeSnapshots(sessionId: string): number {
  const safeSessionId = assertSafeRuntimeId(sessionId, 'session id');
  return withRuntimeSnapshotDb((db) => {
    const rows = db.prepare<unknown[], RuntimeSnapshotRow>(`
      SELECT *
      FROM runtime_snapshots
      WHERE runtime_type = ? AND session_id = ?
    `).all(CLAUDE_SESSION_MAP_RUNTIME_TYPE, safeSessionId);
    let deleted = 0;
    const byScope = new Map<string, RuntimeSnapshotRow[]>();
    for (const row of rows) {
      const key = `${row.tenant_id}\0${row.workspace_id}`;
      const scopedRows = byScope.get(key) ?? [];
      scopedRows.push(row);
      byScope.set(key, scopedRows);
    }
    for (const scopedRows of byScope.values()) {
      const [first] = scopedRows;
      const repo = createEnterpriseWorkspaceRepository<RuntimeSnapshotRow>(db, 'runtime_snapshots');
      for (const row of scopedRows) {
        deleted += repo.deleteById({
          tenantId: first.tenant_id,
          workspaceId: first.workspace_id,
        }, row.id);
      }
    }
    return deleted;
  });
}
