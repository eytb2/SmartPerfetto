// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type {
  ComparisonMetricKey,
  ComparisonResult,
  MultiTraceComparisonRun,
  MultiTraceComparisonRunStatus,
} from '../types/multiTraceComparison';
import {
  MULTI_TRACE_COMPARISON_RUN_SCHEMA_VERSION,
} from '../types/multiTraceComparison';
import type { EnterpriseRepositoryScope } from './enterpriseRepository';
import { recordEnterpriseAuditEvent } from './enterpriseAuditService';

interface ComparisonRunRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  created_by: string | null;
  baseline_snapshot_id: string | null;
  query: string;
  status: MultiTraceComparisonRunStatus;
  result_json: string | null;
  report_id: string | null;
  error: string | null;
  schema_version: typeof MULTI_TRACE_COMPARISON_RUN_SCHEMA_VERSION;
  created_at: number;
  completed_at: number | null;
}

interface ComparisonInputRow {
  snapshot_id: string;
  role: 'baseline' | 'candidate';
  ordinal: number;
}

export interface CreateComparisonRunInput {
  id?: string;
  baselineSnapshotId?: string;
  candidateSnapshotIds: string[];
  query: string;
  metricKeys?: ComparisonMetricKey[];
  status?: MultiTraceComparisonRunStatus;
}

export interface UpdateComparisonRunInput {
  status: MultiTraceComparisonRunStatus;
  result?: ComparisonResult;
  reportId?: string;
  error?: string;
  completedAt?: number;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRun(row: ComparisonRunRow, inputRows: ComparisonInputRow[]): MultiTraceComparisonRun {
  const orderedInputs = [...inputRows].sort((a, b) => a.ordinal - b.ordinal);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    ...(row.created_by ? { createdBy: row.created_by } : {}),
    inputSnapshotIds: orderedInputs.map(input => input.snapshot_id),
    ...(row.baseline_snapshot_id ? { baselineSnapshotId: row.baseline_snapshot_id } : {}),
    query: row.query,
    status: row.status,
    ...(row.result_json ? { result: parseJson<ComparisonResult | undefined>(row.result_json, undefined) } : {}),
    ...(row.report_id ? { reportId: row.report_id } : {}),
    ...(row.error ? { error: row.error } : {}),
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function uniqueSnapshotIds(baselineSnapshotId: string | undefined, candidates: string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of [baselineSnapshotId, ...candidates]) {
    const normalized = id?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

export class MultiTraceComparisonRunRepository {
  constructor(private readonly db: Database.Database) {}

  createRun(
    scope: EnterpriseRepositoryScope,
    input: CreateComparisonRunInput,
  ): MultiTraceComparisonRun {
    const now = Date.now();
    const id = input.id || crypto.randomUUID();
    const baselineSnapshotId = input.baselineSnapshotId?.trim() || undefined;
    const inputSnapshotIds = uniqueSnapshotIds(
      baselineSnapshotId,
      input.candidateSnapshotIds,
    );
    if (inputSnapshotIds.length < 2) {
      throw new Error('comparison run requires at least two snapshots');
    }

    const write = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO multi_trace_comparison_runs
          (id, tenant_id, workspace_id, created_by, baseline_snapshot_id,
           query, status, result_json, report_id, error, schema_version,
           created_at, completed_at)
        VALUES
          (@id, @tenantId, @workspaceId, @createdBy, @baselineSnapshotId,
           @query, @status, NULL, NULL, NULL, @schemaVersion, @createdAt, NULL)
      `).run({
        id,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        createdBy: scope.userId ?? null,
        baselineSnapshotId: baselineSnapshotId ?? null,
        query: input.query,
        status: input.status ?? 'pending',
        schemaVersion: MULTI_TRACE_COMPARISON_RUN_SCHEMA_VERSION,
        createdAt: now,
      });

      const insertInput = this.db.prepare(`
        INSERT INTO multi_trace_comparison_inputs
          (comparison_id, snapshot_id, role, ordinal)
        VALUES
          (@comparisonId, @snapshotId, @role, @ordinal)
      `);
      inputSnapshotIds.forEach((snapshotId, ordinal) => {
        insertInput.run({
          comparisonId: id,
          snapshotId,
          role: snapshotId === baselineSnapshotId ? 'baseline' : 'candidate',
          ordinal,
        });
      });

      recordEnterpriseAuditEvent(this.db, {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        actorUserId: scope.userId,
        action: 'comparison.created',
        resourceType: 'multi_trace_comparison_run',
        resourceId: id,
        metadata: {
          baselineSnapshotId: baselineSnapshotId ?? null,
          inputSnapshotCount: inputSnapshotIds.length,
          status: input.status ?? 'pending',
        },
      });
    });
    write();

    const run = this.getRun(scope, id);
    if (!run) {
      throw new Error('Failed to persist comparison run');
    }
    return run;
  }

  getRun(scope: EnterpriseRepositoryScope, comparisonId: string): MultiTraceComparisonRun | null {
    const row = this.db.prepare<unknown[], ComparisonRunRow>(`
      SELECT *
      FROM multi_trace_comparison_runs
      WHERE tenant_id = @tenantId
        AND workspace_id = @workspaceId
        AND id = @comparisonId
        AND (created_by = @userId OR created_by IS NULL)
      LIMIT 1
    `).get({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      userId: scope.userId ?? null,
      comparisonId,
    });
    if (!row) return null;
    const inputRows = this.db.prepare<unknown[], ComparisonInputRow>(`
      SELECT snapshot_id, role, ordinal
      FROM multi_trace_comparison_inputs
      WHERE comparison_id = ?
      ORDER BY ordinal ASC
    `).all(row.id);
    return mapRun(row, inputRows);
  }

  updateRun(
    scope: EnterpriseRepositoryScope,
    comparisonId: string,
    input: UpdateComparisonRunInput,
  ): MultiTraceComparisonRun | null {
    const completedAt = input.completedAt
      ?? (['completed', 'failed', 'needs_selection'].includes(input.status)
        ? Date.now()
        : null);
    const resultJson = input.result ? JSON.stringify(input.result) : null;
    const update = this.db.prepare(`
      UPDATE multi_trace_comparison_runs
      SET status = @status,
          result_json = @resultJson,
          report_id = @reportId,
          error = @error,
          completed_at = @completedAt
      WHERE tenant_id = @tenantId
        AND workspace_id = @workspaceId
        AND id = @comparisonId
        AND (created_by = @userId OR created_by IS NULL)
    `).run({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      userId: scope.userId ?? null,
      comparisonId,
      status: input.status,
      resultJson,
      reportId: input.reportId ?? null,
      error: input.error ?? null,
      completedAt,
    });
    if (update.changes === 0) return null;
    recordEnterpriseAuditEvent(this.db, {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      actorUserId: scope.userId,
      action: 'comparison.updated',
      resourceType: 'multi_trace_comparison_run',
      resourceId: comparisonId,
      metadata: {
        status: input.status,
        reportId: input.reportId ?? null,
      },
    });
    return this.getRun(scope, comparisonId);
  }
}

export function createMultiTraceComparisonRunRepository(
  db: Database.Database,
): MultiTraceComparisonRunRepository {
  return new MultiTraceComparisonRunRepository(db);
}
