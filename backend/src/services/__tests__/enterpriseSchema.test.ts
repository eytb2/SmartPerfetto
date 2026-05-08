// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import Database from 'better-sqlite3';
import {
  applyEnterpriseMinimalSchema,
  ENTERPRISE_MINIMAL_SCHEMA_TABLES,
} from '../enterpriseSchema';

function tableNames(db: Database.Database): Set<string> {
  const rows = db.prepare<unknown[], { name: string }>(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all();
  return new Set(rows.map(row => row.name));
}

function columnNames(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare<unknown[], { name: string }>(`PRAGMA table_info(${table})`).all();
  return new Set(rows.map(row => row.name));
}

function indexNames(db: Database.Database): Set<string> {
  const rows = db.prepare<unknown[], { name: string }>(`
    SELECT name FROM sqlite_master WHERE type = 'index'
  `).all();
  return new Set(rows.map(row => row.name));
}

describe('enterprise minimal schema', () => {
  let db: Database.Database | undefined;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  test('creates the §0.1.7 minimal enterprise tables and key columns', () => {
    applyEnterpriseMinimalSchema(db!);

    const tables = tableNames(db!);
    for (const table of ENTERPRISE_MINIMAL_SCHEMA_TABLES) {
      expect(tables.has(table)).toBe(true);
    }
    expect(tables.has('enterprise_schema_migrations')).toBe(true);

    expect([...columnNames(db!, 'organizations')]).toEqual(expect.arrayContaining([
      'id',
      'name',
      'status',
      'plan',
      'created_at',
      'updated_at',
    ]));
    expect([...columnNames(db!, 'trace_assets')]).toEqual(expect.arrayContaining([
      'id',
      'tenant_id',
      'workspace_id',
      'owner_user_id',
      'local_path',
      'sha256',
      'size_bytes',
      'status',
      'metadata_json',
      'created_at',
      'expires_at',
    ]));
    expect([...columnNames(db!, 'analysis_sessions')]).toEqual(expect.arrayContaining([
      'id',
      'tenant_id',
      'workspace_id',
      'trace_id',
      'created_by',
      'provider_snapshot_id',
      'visibility',
      'status',
      'created_at',
      'updated_at',
    ]));
    expect([...columnNames(db!, 'agent_events')]).toEqual(expect.arrayContaining([
      'id',
      'tenant_id',
      'workspace_id',
      'run_id',
      'cursor',
      'event_type',
      'payload_json',
      'created_at',
    ]));
    expect([...columnNames(db!, 'provider_snapshots')]).toEqual(expect.arrayContaining([
      'id',
      'tenant_id',
      'provider_id',
      'snapshot_hash',
      'runtime_kind',
      'resolved_config_json',
      'secret_version',
      'created_at',
    ]));
  });

  test('creates owner-guard and replay indexes for high-risk lookup paths', () => {
    applyEnterpriseMinimalSchema(db!);

    const indexes = indexNames(db!);
    expect(indexes.has('idx_trace_assets_owner_guard')).toBe(true);
    expect(indexes.has('idx_analysis_sessions_owner_guard')).toBe(true);
    expect(indexes.has('idx_analysis_runs_status')).toBe(true);
    expect(indexes.has('idx_agent_events_replay')).toBe(true);
    expect(indexes.has('idx_agent_events_owner_guard')).toBe(true);
    expect(indexes.has('idx_provider_snapshots_provider')).toBe(true);
  });

  test('is idempotent and records the applied schema version once', () => {
    applyEnterpriseMinimalSchema(db!);
    applyEnterpriseMinimalSchema(db!);

    const rows = db!.prepare<unknown[], { version: number }>(
      'SELECT version FROM enterprise_schema_migrations ORDER BY version',
    ).all();
    expect(rows).toEqual([{ version: 1 }]);
  });

  test('enforces the tenant workspace session run event chain', () => {
    applyEnterpriseMinimalSchema(db!);
    const now = Date.now();

    db!.prepare(`
      INSERT INTO organizations (id, name, status, plan, created_at, updated_at)
      VALUES ('tenant-a', 'Tenant A', 'active', 'enterprise', ?, ?)
    `).run(now, now);
    db!.prepare(`
      INSERT INTO workspaces (id, tenant_id, name, created_at, updated_at)
      VALUES ('workspace-a', 'tenant-a', 'Workspace A', ?, ?)
    `).run(now, now);
    db!.prepare(`
      INSERT INTO users (id, tenant_id, email, display_name, idp_subject, created_at, updated_at)
      VALUES ('user-a', 'tenant-a', 'a@example.test', 'User A', 'oidc|a', ?, ?)
    `).run(now, now);
    db!.prepare(`
      INSERT INTO memberships (tenant_id, workspace_id, user_id, role, created_at)
      VALUES ('tenant-a', 'workspace-a', 'user-a', 'admin', ?)
    `).run(now);
    db!.prepare(`
      INSERT INTO trace_assets
        (id, tenant_id, workspace_id, owner_user_id, local_path, sha256, size_bytes, status, created_at)
      VALUES
        ('trace-a', 'tenant-a', 'workspace-a', 'user-a', '/tmp/trace-a.pftrace', 'abc123', 1024, 'ready', ?)
    `).run(now);
    db!.prepare(`
      INSERT INTO provider_snapshots
        (id, tenant_id, provider_id, snapshot_hash, runtime_kind, resolved_config_json, secret_version, created_at)
      VALUES
        ('provider-snapshot-a', 'tenant-a', 'provider-a', 'hash-a', 'openai-agents-sdk', '{"models":{}}', 'v1', ?)
    `).run(now);
    db!.prepare(`
      INSERT INTO analysis_sessions
        (id, tenant_id, workspace_id, trace_id, created_by, provider_snapshot_id, visibility, status, created_at, updated_at)
      VALUES
        ('session-a', 'tenant-a', 'workspace-a', 'trace-a', 'user-a', 'provider-snapshot-a', 'private', 'running', ?, ?)
    `).run(now, now);
    db!.prepare(`
      INSERT INTO analysis_runs
        (id, tenant_id, workspace_id, session_id, mode, status, question, started_at)
      VALUES
        ('run-a', 'tenant-a', 'workspace-a', 'session-a', 'full', 'running', 'analyze', ?)
    `).run(now);
    db!.prepare(`
      INSERT INTO agent_events
        (id, tenant_id, workspace_id, run_id, cursor, event_type, payload_json, created_at)
      VALUES
        ('event-a-1', 'tenant-a', 'workspace-a', 'run-a', 1, 'progress', '{}', ?)
    `).run(now);

    expect(() => {
      db!.prepare(`
        INSERT INTO agent_events
          (id, tenant_id, workspace_id, run_id, cursor, event_type, payload_json, created_at)
        VALUES
          ('event-a-duplicate', 'tenant-a', 'workspace-a', 'run-a', 1, 'progress', '{}', ?)
      `).run(now);
    }).toThrow();
    expect(() => {
      db!.prepare(`
        INSERT INTO analysis_runs
          (id, tenant_id, workspace_id, session_id, mode, status, question, started_at)
        VALUES
          ('run-missing', 'tenant-a', 'workspace-a', 'missing-session', 'full', 'running', 'analyze', ?)
      `).run(now);
    }).toThrow();
  });
});
