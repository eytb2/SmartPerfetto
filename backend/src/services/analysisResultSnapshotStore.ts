// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type {
  AnalysisResultSceneType,
  AnalysisResultSnapshot,
  AnalysisResultSnapshotStatus,
  AnalysisResultVisibility,
  AnalysisSummary,
  ComparisonMetricKey,
  EvidenceRef,
  EvidenceRefType,
  NormalizedMetricAggregation,
  NormalizedMetricDirection,
  NormalizedMetricSource,
  NormalizedMetricUnit,
  NormalizedMetricValue,
  TraceComparisonMetadata,
} from '../types/multiTraceComparison';
import type { EnterpriseRepositoryScope } from './enterpriseRepository';
import { recordEnterpriseAuditEvent } from './enterpriseAuditService';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface SnapshotRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  trace_id: string;
  session_id: string;
  run_id: string;
  report_id: string | null;
  created_by: string | null;
  visibility: AnalysisResultVisibility;
  scene_type: AnalysisResultSceneType;
  title: string;
  user_query: string;
  trace_label: string;
  trace_metadata_json: string;
  summary_json: string;
  status: AnalysisResultSnapshotStatus;
  schema_version: AnalysisResultSnapshot['schemaVersion'];
  created_at: number;
  expires_at: number | null;
}

interface MetricRow {
  metric_key: ComparisonMetricKey;
  metric_group: string;
  label: string;
  value_json: string | null;
  numeric_value: number | null;
  unit: NormalizedMetricUnit | null;
  direction: NormalizedMetricDirection | null;
  aggregation: NormalizedMetricAggregation | null;
  confidence: number;
  missing_reason: string | null;
  source_json: string;
}

interface EvidenceRow {
  id: string;
  ref_type: EvidenceRefType;
  ref_json: string;
}

export interface AnalysisResultSnapshotListFilters {
  traceId?: string;
  sceneType?: AnalysisResultSceneType;
  visibility?: AnalysisResultVisibility;
  createdBy?: string;
  includeExpired?: boolean;
  limit?: number;
}

export interface SnapshotAccessScope extends EnterpriseRepositoryScope {
  auditActorUserId?: string;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function metricNumericValue(metric: NormalizedMetricValue): number | null {
  return typeof metric.value === 'number' && Number.isFinite(metric.value) ? metric.value : null;
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('limit must be an integer between 1 and 500');
  }
  return limit;
}

function readableClause(scope: SnapshotAccessScope, alias = 's'): {
  sql: string;
  params: Record<string, string | number | null>;
} {
  const params: Record<string, string | number | null> = {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    userId: scope.userId ?? null,
  };
  const ownerClause = scope.userId
    ? `${alias}.created_by = @userId`
    : `${alias}.created_by IS NULL`;
  return {
    sql: [
      `${alias}.tenant_id = @tenantId`,
      `${alias}.workspace_id = @workspaceId`,
      `(${alias}.visibility = 'workspace' OR ${alias}.created_by IS NULL OR ${ownerClause})`,
    ].join(' AND '),
    params,
  };
}

function writableOwnerClause(scope: SnapshotAccessScope, alias = 's'): {
  sql: string;
  params: Record<string, string | number | null>;
} {
  return {
    sql: [
      `${alias}.tenant_id = @tenantId`,
      `${alias}.workspace_id = @workspaceId`,
      scope.userId ? `${alias}.created_by = @userId` : `${alias}.created_by IS NULL`,
    ].join(' AND '),
    params: {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      userId: scope.userId ?? null,
    },
  };
}

function mapSnapshot(row: SnapshotRow, metrics: NormalizedMetricValue[], evidenceRefs: EvidenceRef[]): AnalysisResultSnapshot {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    traceId: row.trace_id,
    sessionId: row.session_id,
    runId: row.run_id,
    ...(row.report_id ? { reportId: row.report_id } : {}),
    ...(row.created_by ? { createdBy: row.created_by } : {}),
    visibility: row.visibility,
    sceneType: row.scene_type,
    title: row.title,
    userQuery: row.user_query,
    traceLabel: row.trace_label,
    traceMetadata: parseJson<TraceComparisonMetadata>(row.trace_metadata_json, {}),
    summary: parseJson<AnalysisSummary>(row.summary_json, { headline: '' }),
    metrics,
    evidenceRefs,
    status: row.status,
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
  };
}

function mapMetric(row: MetricRow): NormalizedMetricValue {
  return {
    key: row.metric_key,
    label: row.label,
    group: row.metric_group,
    value: row.value_json === null ? null : parseJson<number | string | null>(row.value_json, null),
    ...(row.unit ? { unit: row.unit } : {}),
    ...(row.direction ? { direction: row.direction } : {}),
    ...(row.aggregation ? { aggregation: row.aggregation } : {}),
    confidence: row.confidence,
    ...(row.missing_reason ? { missingReason: row.missing_reason } : {}),
    source: parseJson<NormalizedMetricSource>(row.source_json, { type: 'manual' }),
  };
}

function mapEvidence(row: EvidenceRow): EvidenceRef {
  const ref = parseJson<EvidenceRef>(row.ref_json, { id: row.id, type: row.ref_type });
  return {
    ...ref,
    id: ref.id || row.id,
    type: ref.type || row.ref_type,
  };
}

export class AnalysisResultSnapshotRepository {
  constructor(private readonly db: Database.Database) {}

  createSnapshot(snapshot: AnalysisResultSnapshot): AnalysisResultSnapshot {
    const write = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO analysis_result_snapshots
          (id, tenant_id, workspace_id, trace_id, session_id, run_id, report_id, created_by,
           visibility, scene_type, title, user_query, trace_label, trace_metadata_json,
           summary_json, status, schema_version, created_at, expires_at)
        VALUES
          (@id, @tenantId, @workspaceId, @traceId, @sessionId, @runId, @reportId, @createdBy,
           @visibility, @sceneType, @title, @userQuery, @traceLabel, @traceMetadataJson,
           @summaryJson, @status, @schemaVersion, @createdAt, @expiresAt)
      `).run({
        id: snapshot.id,
        tenantId: snapshot.tenantId,
        workspaceId: snapshot.workspaceId,
        traceId: snapshot.traceId,
        sessionId: snapshot.sessionId,
        runId: snapshot.runId,
        reportId: snapshot.reportId ?? null,
        createdBy: snapshot.createdBy ?? null,
        visibility: snapshot.visibility,
        sceneType: snapshot.sceneType,
        title: snapshot.title,
        userQuery: snapshot.userQuery,
        traceLabel: snapshot.traceLabel,
        traceMetadataJson: stringifyJson(snapshot.traceMetadata),
        summaryJson: stringifyJson(snapshot.summary),
        status: snapshot.status,
        schemaVersion: snapshot.schemaVersion,
        createdAt: snapshot.createdAt,
        expiresAt: snapshot.expiresAt ?? null,
      });

      const insertMetric = this.db.prepare(`
        INSERT INTO analysis_result_metrics
          (id, snapshot_id, metric_key, metric_group, label, value_json, numeric_value, unit,
           direction, aggregation, confidence, missing_reason, source_json)
        VALUES
          (@id, @snapshotId, @metricKey, @metricGroup, @label, @valueJson, @numericValue, @unit,
           @direction, @aggregation, @confidence, @missingReason, @sourceJson)
      `);
      for (const metric of snapshot.metrics) {
        insertMetric.run({
          id: crypto.randomUUID(),
          snapshotId: snapshot.id,
          metricKey: metric.key,
          metricGroup: metric.group,
          label: metric.label,
          valueJson: stringifyJson(metric.value),
          numericValue: metricNumericValue(metric),
          unit: metric.unit ?? null,
          direction: metric.direction ?? null,
          aggregation: metric.aggregation ?? null,
          confidence: metric.confidence,
          missingReason: metric.missingReason ?? null,
          sourceJson: stringifyJson(metric.source),
        });
      }

      const insertEvidence = this.db.prepare(`
        INSERT INTO analysis_result_evidence_refs
          (id, snapshot_id, ref_type, ref_json, created_at)
        VALUES
          (@id, @snapshotId, @refType, @refJson, @createdAt)
      `);
      for (const evidence of snapshot.evidenceRefs) {
        insertEvidence.run({
          id: evidence.id || crypto.randomUUID(),
          snapshotId: snapshot.id,
          refType: evidence.type,
          refJson: stringifyJson(evidence),
          createdAt: snapshot.createdAt,
        });
      }

      recordEnterpriseAuditEvent(this.db, {
        tenantId: snapshot.tenantId,
        workspaceId: snapshot.workspaceId,
        actorUserId: snapshot.createdBy,
        action: 'analysis_result.created',
        resourceType: 'analysis_result_snapshot',
        resourceId: snapshot.id,
        metadata: {
          traceId: snapshot.traceId,
          sessionId: snapshot.sessionId,
          runId: snapshot.runId,
          visibility: snapshot.visibility,
          sceneType: snapshot.sceneType,
          metricCount: snapshot.metrics.length,
        },
      });
    });
    write();
    return snapshot;
  }

  getSnapshot(scope: SnapshotAccessScope, snapshotId: string): AnalysisResultSnapshot | null {
    const where = readableClause(scope);
    const row = this.db.prepare<unknown[], SnapshotRow>(`
      SELECT s.*
      FROM analysis_result_snapshots s
      WHERE ${where.sql}
        AND s.id = @snapshotId
        AND (s.expires_at IS NULL OR s.expires_at > @now)
      LIMIT 1
    `).get({
      ...where.params,
      snapshotId,
      now: Date.now(),
    });
    if (!row) return null;
    const snapshot = this.hydrateSnapshot(row);
    this.recordReadAudit(scope, snapshot.id, 'analysis_result.read');
    return snapshot;
  }

  listSnapshots(
    scope: SnapshotAccessScope,
    filters: AnalysisResultSnapshotListFilters = {},
  ): AnalysisResultSnapshot[] {
    const where = readableClause(scope);
    const clauses = [where.sql];
    const params: Record<string, string | number | null> = {
      ...where.params,
      now: Date.now(),
      limit: boundedLimit(filters.limit),
    };
    if (!filters.includeExpired) {
      clauses.push('(s.expires_at IS NULL OR s.expires_at > @now)');
    }
    if (filters.traceId) {
      clauses.push('s.trace_id = @traceId');
      params.traceId = filters.traceId;
    }
    if (filters.sceneType) {
      clauses.push('s.scene_type = @sceneType');
      params.sceneType = filters.sceneType;
    }
    if (filters.visibility) {
      clauses.push('s.visibility = @visibility');
      params.visibility = filters.visibility;
    }
    if (filters.createdBy) {
      clauses.push('s.created_by = @createdBy');
      params.createdBy = filters.createdBy;
    }

    const rows = this.db.prepare<unknown[], SnapshotRow>(`
      SELECT s.*
      FROM analysis_result_snapshots s
      WHERE ${clauses.join(' AND ')}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT @limit
    `).all(params);
    if (rows.length > 0) {
      this.recordReadAudit(scope, undefined, 'analysis_result.listed', { count: rows.length });
    }
    return rows.map(row => this.hydrateSnapshot(row));
  }

  updateVisibility(
    scope: SnapshotAccessScope,
    snapshotId: string,
    visibility: AnalysisResultVisibility,
  ): AnalysisResultSnapshot | null {
    const where = writableOwnerClause(scope);
    const result = this.db.prepare(`
      UPDATE analysis_result_snapshots AS s
      SET visibility = @visibility
      WHERE ${where.sql}
        AND s.id = @snapshotId
        AND (s.expires_at IS NULL OR s.expires_at > @now)
    `).run({
      ...where.params,
      snapshotId,
      visibility,
      now: Date.now(),
    });
    if (result.changes === 0) return null;
    this.recordReadAudit(scope, snapshotId, 'analysis_result.visibility_updated', { visibility });
    return this.getSnapshot(scope, snapshotId);
  }

  deleteSnapshot(scope: SnapshotAccessScope, snapshotId: string): boolean {
    const where = writableOwnerClause(scope);
    const result = this.db.prepare(`
      DELETE FROM analysis_result_snapshots AS s
      WHERE ${where.sql}
        AND s.id = @snapshotId
    `).run({
      ...where.params,
      snapshotId,
    });
    if (result.changes > 0) {
      this.recordReadAudit(scope, snapshotId, 'analysis_result.deleted');
    }
    return result.changes > 0;
  }

  private hydrateSnapshot(row: SnapshotRow): AnalysisResultSnapshot {
    const metrics = this.db.prepare<unknown[], MetricRow>(`
      SELECT metric_key, metric_group, label, value_json, numeric_value, unit,
             direction, aggregation, confidence, missing_reason, source_json
      FROM analysis_result_metrics
      WHERE snapshot_id = ?
      ORDER BY metric_group ASC, metric_key ASC
    `).all(row.id).map(mapMetric);
    const evidenceRefs = this.db.prepare<unknown[], EvidenceRow>(`
      SELECT id, ref_type, ref_json
      FROM analysis_result_evidence_refs
      WHERE snapshot_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(row.id).map(mapEvidence);
    return mapSnapshot(row, metrics, evidenceRefs);
  }

  private recordReadAudit(
    scope: SnapshotAccessScope,
    snapshotId: string | undefined,
    action: string,
    metadata: Record<string, JsonValue> = {},
  ): void {
    recordEnterpriseAuditEvent(this.db, {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      actorUserId: scope.auditActorUserId ?? scope.userId,
      action,
      resourceType: 'analysis_result_snapshot',
      resourceId: snapshotId,
      metadata,
    });
  }
}

export function createAnalysisResultSnapshotRepository(
  db: Database.Database,
): AnalysisResultSnapshotRepository {
  return new AnalysisResultSnapshotRepository(db);
}
