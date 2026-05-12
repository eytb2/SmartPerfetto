// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type Database from 'better-sqlite3';
import type {
  AnalysisResultSceneType,
  AnalysisResultWindowState,
} from '../types/multiTraceComparison';
import type { EnterpriseRepositoryScope } from './enterpriseRepository';

const DEFAULT_WINDOW_STATE_TTL_MS = 2 * 60 * 1000;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface WindowStateRow {
  tenant_id: string;
  workspace_id: string;
  window_id: string;
  user_id: string | null;
  trace_id: string | null;
  backend_trace_id: string | null;
  active_session_id: string | null;
  latest_snapshot_id: string | null;
  trace_title: string | null;
  scene_type: AnalysisResultSceneType | null;
  metadata_json: string | null;
  updated_at: number;
  expires_at: number;
}

export interface AnalysisResultWindowHeartbeatInput {
  windowId: string;
  userId?: string;
  traceId?: string;
  backendTraceId?: string;
  activeSessionId?: string;
  latestSnapshotId?: string;
  traceTitle?: string;
  sceneType?: AnalysisResultSceneType;
  metadata?: Record<string, JsonValue>;
  ttlMs?: number;
}

export interface ListActiveWindowStateOptions {
  excludeWindowId?: string;
  limit?: number;
  now?: number;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function optionalText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('limit must be an integer between 1 and 100');
  }
  return limit;
}

function ttlFromInput(ttlMs: number | undefined): number {
  if (ttlMs === undefined) return DEFAULT_WINDOW_STATE_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs < 15_000 || ttlMs > 10 * 60 * 1000) {
    throw new Error('ttlMs must be between 15000 and 600000');
  }
  return Math.floor(ttlMs);
}

function mapWindowState(row: WindowStateRow): AnalysisResultWindowState {
  return {
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    windowId: row.window_id,
    ...(row.user_id ? { userId: row.user_id } : {}),
    ...(row.trace_id ? { traceId: row.trace_id } : {}),
    ...(row.backend_trace_id ? { backendTraceId: row.backend_trace_id } : {}),
    ...(row.active_session_id ? { activeSessionId: row.active_session_id } : {}),
    ...(row.latest_snapshot_id ? { latestSnapshotId: row.latest_snapshot_id } : {}),
    ...(row.trace_title ? { traceTitle: row.trace_title } : {}),
    ...(row.scene_type ? { sceneType: row.scene_type } : {}),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

export class AnalysisResultWindowStateRepository {
  constructor(private readonly db: Database.Database) {}

  upsertWindowState(
    scope: EnterpriseRepositoryScope,
    input: AnalysisResultWindowHeartbeatInput,
  ): AnalysisResultWindowState {
    const now = Date.now();
    const ttlMs = ttlFromInput(input.ttlMs);
    const params = {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      windowId: input.windowId,
      userId: optionalText(input.userId ?? scope.userId),
      traceId: optionalText(input.traceId),
      backendTraceId: optionalText(input.backendTraceId),
      activeSessionId: optionalText(input.activeSessionId),
      latestSnapshotId: optionalText(input.latestSnapshotId),
      traceTitle: optionalText(input.traceTitle),
      sceneType: optionalText(input.sceneType),
      metadataJson: JSON.stringify(input.metadata ?? {}),
      updatedAt: now,
      expiresAt: now + ttlMs,
    };

    this.db.prepare(`
      INSERT INTO analysis_result_window_states
        (tenant_id, workspace_id, window_id, user_id, trace_id, backend_trace_id,
         active_session_id, latest_snapshot_id, trace_title, scene_type,
         metadata_json, updated_at, expires_at)
      VALUES
        (@tenantId, @workspaceId, @windowId, @userId, @traceId, @backendTraceId,
         @activeSessionId, @latestSnapshotId, @traceTitle, @sceneType,
         @metadataJson, @updatedAt, @expiresAt)
      ON CONFLICT(tenant_id, workspace_id, window_id) DO UPDATE SET
        user_id = excluded.user_id,
        trace_id = excluded.trace_id,
        backend_trace_id = excluded.backend_trace_id,
        active_session_id = excluded.active_session_id,
        latest_snapshot_id = excluded.latest_snapshot_id,
        trace_title = excluded.trace_title,
        scene_type = excluded.scene_type,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `).run(params);

    const state = this.getWindowState(scope, input.windowId);
    if (!state) {
      throw new Error('Failed to persist analysis result window state');
    }
    return state;
  }

  getWindowState(
    scope: EnterpriseRepositoryScope,
    windowId: string,
  ): AnalysisResultWindowState | null {
    const row = this.db.prepare<unknown[], WindowStateRow>(`
      SELECT *
      FROM analysis_result_window_states
      WHERE tenant_id = @tenantId
        AND workspace_id = @workspaceId
        AND window_id = @windowId
      LIMIT 1
    `).get({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      windowId,
    });
    return row ? mapWindowState(row) : null;
  }

  listActiveWindowStates(
    scope: EnterpriseRepositoryScope,
    options: ListActiveWindowStateOptions = {},
  ): AnalysisResultWindowState[] {
    const clauses = [
      'tenant_id = @tenantId',
      'workspace_id = @workspaceId',
      'expires_at > @now',
    ];
    const params: Record<string, string | number | null> = {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      now: options.now ?? Date.now(),
      limit: boundedLimit(options.limit),
    };
    if (options.excludeWindowId) {
      clauses.push('window_id != @excludeWindowId');
      params.excludeWindowId = options.excludeWindowId;
    }

    return this.db.prepare<unknown[], WindowStateRow>(`
      SELECT *
      FROM analysis_result_window_states
      WHERE ${clauses.join(' AND ')}
      ORDER BY updated_at DESC, window_id ASC
      LIMIT @limit
    `).all(params).map(mapWindowState);
  }
}

export function createAnalysisResultWindowStateRepository(
  db: Database.Database,
): AnalysisResultWindowStateRepository {
  return new AnalysisResultWindowStateRepository(db);
}
