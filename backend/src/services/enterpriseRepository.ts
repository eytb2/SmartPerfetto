// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type Database from 'better-sqlite3';
import type { RequestContext } from '../middleware/auth';

type SqliteBindValue = string | number | bigint | Buffer | null;

export interface EnterpriseRepositoryScope {
  tenantId: string;
  workspaceId: string;
  userId?: string;
}

export type EnterpriseWorkspaceScopedTable =
  | 'trace_assets'
  | 'analysis_sessions'
  | 'analysis_runs'
  | 'agent_events'
  | 'runtime_snapshots';

export const ENTERPRISE_WORKSPACE_SCOPED_TABLES: readonly EnterpriseWorkspaceScopedTable[] = [
  'trace_assets',
  'analysis_sessions',
  'analysis_runs',
  'agent_events',
  'runtime_snapshots',
];

export type EnterpriseQueryCriteria = Record<string, SqliteBindValue | undefined>;
export type EnterpriseUpdateValues = Record<string, SqliteBindValue | undefined>;

export interface ScopedWhereClause {
  sql: string;
  params: Record<string, SqliteBindValue>;
}

export interface ListOptions {
  orderBy?: string;
  direction?: 'ASC' | 'DESC';
  limit?: number;
}

const IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/;
const SCOPE_COLUMNS = new Set(['tenant_id', 'workspace_id']);
const IMMUTABLE_UPDATE_COLUMNS = new Set(['id', 'tenant_id', 'workspace_id']);

function assertNonEmptyId(value: string, name: string): void {
  if (!value.trim()) {
    throw new Error(`${name} is required`);
  }
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_RE.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function assertWorkspaceScopedTable(table: string): asserts table is EnterpriseWorkspaceScopedTable {
  if (!(ENTERPRISE_WORKSPACE_SCOPED_TABLES as readonly string[]).includes(table)) {
    throw new Error(`Table is not workspace-scoped: ${table}`);
  }
}

export function repositoryScopeFromRequestContext(context: RequestContext): EnterpriseRepositoryScope {
  return {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    userId: context.userId,
  };
}

export function buildWorkspaceScopedWhere(
  scope: EnterpriseRepositoryScope,
  criteria: EnterpriseQueryCriteria = {},
): ScopedWhereClause {
  assertNonEmptyId(scope.tenantId, 'tenantId');
  assertNonEmptyId(scope.workspaceId, 'workspaceId');

  const clauses = [
    'tenant_id = @scopeTenantId',
    'workspace_id = @scopeWorkspaceId',
  ];
  const params: Record<string, SqliteBindValue> = {
    scopeTenantId: scope.tenantId,
    scopeWorkspaceId: scope.workspaceId,
  };

  for (const [column, value] of Object.entries(criteria)) {
    if (value === undefined) continue;
    assertIdentifier(column, 'criteria column');
    if (SCOPE_COLUMNS.has(column)) {
      throw new Error(`${column} must come from EnterpriseRepositoryScope`);
    }
    const paramName = `criteria_${column}`;
    clauses.push(`${column} = @${paramName}`);
    params[paramName] = value;
  }

  return {
    sql: clauses.join(' AND '),
    params,
  };
}

function buildOrderClause(options: ListOptions): string {
  if (!options.orderBy) return '';
  assertIdentifier(options.orderBy, 'orderBy column');
  const direction = options.direction ?? 'ASC';
  return ` ORDER BY ${options.orderBy} ${direction}`;
}

function buildLimitClause(options: ListOptions): string {
  if (options.limit === undefined) return '';
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000) {
    throw new Error('limit must be an integer between 1 and 1000');
  }
  return ` LIMIT ${options.limit}`;
}

function normalizeUpdateValues(values: EnterpriseUpdateValues): {
  assignments: string[];
  params: Record<string, SqliteBindValue>;
} {
  const assignments: string[] = [];
  const params: Record<string, SqliteBindValue> = {};

  for (const [column, value] of Object.entries(values)) {
    if (value === undefined) continue;
    assertIdentifier(column, 'update column');
    if (IMMUTABLE_UPDATE_COLUMNS.has(column)) {
      throw new Error(`${column} cannot be updated through a scoped repository`);
    }
    const paramName = `update_${column}`;
    assignments.push(`${column} = @${paramName}`);
    params[paramName] = value;
  }

  if (assignments.length === 0) {
    throw new Error('At least one update value is required');
  }

  return { assignments, params };
}

export class EnterpriseWorkspaceRepository<Row extends Record<string, unknown>> {
  constructor(
    private readonly db: Database.Database,
    private readonly table: EnterpriseWorkspaceScopedTable,
  ) {
    assertWorkspaceScopedTable(table);
  }

  getById(scope: EnterpriseRepositoryScope, id: string): Row | null {
    assertNonEmptyId(id, 'id');
    const where = buildWorkspaceScopedWhere(scope, { id });
    return this.db.prepare(`
      SELECT * FROM ${this.table}
      WHERE ${where.sql}
      LIMIT 1
    `).get(where.params) as Row | undefined ?? null;
  }

  list(
    scope: EnterpriseRepositoryScope,
    criteria: EnterpriseQueryCriteria = {},
    options: ListOptions = {},
  ): Row[] {
    const where = buildWorkspaceScopedWhere(scope, criteria);
    return this.db.prepare(`
      SELECT * FROM ${this.table}
      WHERE ${where.sql}${buildOrderClause(options)}${buildLimitClause(options)}
    `).all(where.params) as Row[];
  }

  updateById(scope: EnterpriseRepositoryScope, id: string, values: EnterpriseUpdateValues): number {
    assertNonEmptyId(id, 'id');
    const where = buildWorkspaceScopedWhere(scope, { id });
    const update = normalizeUpdateValues(values);
    const result = this.db.prepare(`
      UPDATE ${this.table}
      SET ${update.assignments.join(', ')}
      WHERE ${where.sql}
    `).run({
      ...where.params,
      ...update.params,
    });
    return result.changes;
  }

  deleteById(scope: EnterpriseRepositoryScope, id: string): number {
    assertNonEmptyId(id, 'id');
    const where = buildWorkspaceScopedWhere(scope, { id });
    const result = this.db.prepare(`
      DELETE FROM ${this.table}
      WHERE ${where.sql}
    `).run(where.params);
    return result.changes;
  }
}

export function createEnterpriseWorkspaceRepository<Row extends Record<string, unknown>>(
  db: Database.Database,
  table: EnterpriseWorkspaceScopedTable,
): EnterpriseWorkspaceRepository<Row> {
  return new EnterpriseWorkspaceRepository<Row>(db, table);
}
