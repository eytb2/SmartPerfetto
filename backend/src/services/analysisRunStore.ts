// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type Database from 'better-sqlite3';
import { openEnterpriseDb, resolveEnterpriseDbPath } from './enterpriseDb';
import type { EnterpriseRepositoryScope } from './enterpriseRepository';

export type PersistedAnalysisRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AnalysisRunPersistenceScope extends EnterpriseRepositoryScope {
  sessionId: string;
  runId: string;
  traceId: string;
  query?: string;
  mode?: string;
}

export interface AnalysisRunLifecycle {
  id: string;
  status: PersistedAnalysisRunStatus | string;
  startedAt: number;
  completedAt: number | null;
  heartbeatAt: number | null;
  updatedAt: number | null;
  errorJson: string | null;
}

interface AnalysisRunRow extends Record<string, unknown> {
  id: string;
  status: string;
  started_at: number;
  completed_at: number | null;
  heartbeat_at: number | null;
  updated_at: number | null;
  error_json: string | null;
}

let singletonDb: Database.Database | null = null;
let singletonDbPath: string | null = null;

function getAnalysisRunDb(): Database.Database {
  const dbPath = resolveEnterpriseDbPath();
  if (!singletonDb || singletonDbPath !== dbPath) {
    singletonDb?.close();
    singletonDb = openEnterpriseDb(dbPath);
    singletonDbPath = dbPath;
  }
  return singletonDb;
}

export function resetAnalysisRunStoreForTests(): void {
  singletonDb?.close();
  singletonDb = null;
  singletonDbPath = null;
}

function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function ensureAnalysisRunGraph(
  db: Database.Database,
  scope: AnalysisRunPersistenceScope,
  now: number,
): void {
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
      `${scope.userId}@analysis-run.local`,
      scope.userId,
      `analysis-run:${scope.userId}`,
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
    scope.traceId,
    scope.tenantId,
    scope.workspaceId,
    scope.userId ?? null,
    `metadata-only:${scope.traceId}`,
    JSON.stringify({ source: 'analysis_run', sessionId: scope.sessionId, runId: scope.runId }),
    now,
  );

  db.prepare(`
    INSERT OR IGNORE INTO analysis_sessions
      (id, tenant_id, workspace_id, trace_id, created_by, title, visibility, status, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, 'private', 'running', ?, ?)
  `).run(
    scope.sessionId,
    scope.tenantId,
    scope.workspaceId,
    scope.traceId,
    scope.userId ?? null,
    `Agent session ${scope.sessionId}`,
    now,
    now,
  );

  db.prepare(`
    INSERT OR IGNORE INTO analysis_runs
      (id, tenant_id, workspace_id, session_id, mode, status, question, started_at, completed_at, heartbeat_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, 'running', ?, ?, NULL, ?, ?)
  `).run(
    scope.runId,
    scope.tenantId,
    scope.workspaceId,
    scope.sessionId,
    scope.mode ?? 'agent',
    scope.query ?? '',
    now,
    now,
    now,
  );
}

export function persistAnalysisRunState(
  scope: AnalysisRunPersistenceScope,
  status: PersistedAnalysisRunStatus,
  options: { now?: number; error?: string } = {},
): void {
  const now = options.now ?? Date.now();
  const terminal = isTerminalStatus(status);
  const db = getAnalysisRunDb();
  const write = db.transaction(() => {
    ensureAnalysisRunGraph(db, scope, now);
    db.prepare(`
      UPDATE analysis_runs
      SET status = ?,
          question = CASE WHEN ? <> '' THEN ? ELSE question END,
          heartbeat_at = ?,
          updated_at = ?,
          completed_at = CASE WHEN ? THEN COALESCE(completed_at, ?) ELSE completed_at END,
          error_json = ?
      WHERE tenant_id = ?
        AND workspace_id = ?
        AND id = ?
    `).run(
      status,
      scope.query ?? '',
      scope.query ?? '',
      now,
      now,
      terminal ? 1 : 0,
      now,
      options.error ? JSON.stringify({ message: options.error }) : null,
      scope.tenantId,
      scope.workspaceId,
      scope.runId,
    );
    db.prepare(`
      UPDATE analysis_sessions
      SET status = ?, updated_at = ?
      WHERE tenant_id = ?
        AND workspace_id = ?
        AND id = ?
    `).run(
      terminal ? status : 'running',
      now,
      scope.tenantId,
      scope.workspaceId,
      scope.sessionId,
    );
  });
  write();
}

export function heartbeatAnalysisRun(
  scope: AnalysisRunPersistenceScope,
  now = Date.now(),
): void {
  const db = getAnalysisRunDb();
  const write = db.transaction(() => {
    ensureAnalysisRunGraph(db, scope, now);
    db.prepare(`
      UPDATE analysis_runs
      SET heartbeat_at = ?, updated_at = ?
      WHERE tenant_id = ?
        AND workspace_id = ?
        AND id = ?
        AND status IN ('pending', 'running', 'awaiting_user')
    `).run(now, now, scope.tenantId, scope.workspaceId, scope.runId);
    db.prepare(`
      UPDATE analysis_sessions
      SET updated_at = ?
      WHERE tenant_id = ?
        AND workspace_id = ?
        AND id = ?
    `).run(now, scope.tenantId, scope.workspaceId, scope.sessionId);
  });
  write();
}

export function getAnalysisRunLifecycle(
  scope: EnterpriseRepositoryScope,
  runId: string,
): AnalysisRunLifecycle | null {
  const db = getAnalysisRunDb();
  const row = db.prepare<unknown[], AnalysisRunRow>(`
    SELECT id, status, started_at, completed_at, heartbeat_at, updated_at, error_json
    FROM analysis_runs
    WHERE tenant_id = ?
      AND workspace_id = ?
      AND id = ?
    LIMIT 1
  `).get(scope.tenantId, scope.workspaceId, runId);
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    heartbeatAt: row.heartbeat_at,
    updatedAt: row.updated_at,
    errorJson: row.error_json,
  };
}

export function isAnalysisRunHeartbeatFresh(
  scope: EnterpriseRepositoryScope,
  runId: string,
  now: number,
  maxStaleMs: number,
): boolean {
  const lifecycle = getAnalysisRunLifecycle(scope, runId);
  if (!lifecycle || isTerminalStatus(lifecycle.status)) return false;
  const heartbeatAt = lifecycle.heartbeatAt ?? lifecycle.updatedAt ?? lifecycle.startedAt;
  return now - heartbeatAt <= maxStaleMs;
}
