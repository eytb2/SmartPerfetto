// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type Database from 'better-sqlite3';

interface MigrationStep {
  version: number;
  up: (db: Database.Database) => void;
}

export const ENTERPRISE_MINIMAL_SCHEMA_TABLES = [
  'organizations',
  'workspaces',
  'users',
  'memberships',
  'trace_assets',
  'analysis_sessions',
  'analysis_runs',
  'agent_events',
  'provider_snapshots',
] as const;

export type EnterpriseMinimalSchemaTable = typeof ENTERPRISE_MINIMAL_SCHEMA_TABLES[number];

const MIGRATIONS: MigrationStep[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          plan TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_organizations_status
          ON organizations(status);

        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          retention_policy TEXT,
          quota_policy TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_workspaces_tenant
          ON workspaces(tenant_id);

        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          email TEXT NOT NULL,
          display_name TEXT,
          idp_subject TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
          UNIQUE (tenant_id, email),
          UNIQUE (tenant_id, idp_subject)
        );
        CREATE INDEX IF NOT EXISTS idx_users_tenant
          ON users(tenant_id);

        CREATE TABLE IF NOT EXISTS memberships (
          tenant_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (tenant_id, workspace_id, user_id),
          FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_memberships_user
          ON memberships(tenant_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_memberships_workspace
          ON memberships(tenant_id, workspace_id);

        CREATE TABLE IF NOT EXISTS trace_assets (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          owner_user_id TEXT,
          local_path TEXT NOT NULL,
          sha256 TEXT,
          size_bytes INTEGER,
          status TEXT NOT NULL,
          metadata_json TEXT,
          created_at INTEGER NOT NULL,
          expires_at INTEGER,
          FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_trace_assets_owner_guard
          ON trace_assets(tenant_id, workspace_id, id);
        CREATE INDEX IF NOT EXISTS idx_trace_assets_status
          ON trace_assets(tenant_id, workspace_id, status, created_at);
        CREATE INDEX IF NOT EXISTS idx_trace_assets_sha256
          ON trace_assets(tenant_id, workspace_id, sha256);

        CREATE TABLE IF NOT EXISTS provider_snapshots (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          snapshot_hash TEXT NOT NULL,
          runtime_kind TEXT NOT NULL,
          resolved_config_json TEXT NOT NULL,
          secret_version TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
          UNIQUE (tenant_id, snapshot_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_provider_snapshots_provider
          ON provider_snapshots(tenant_id, provider_id, created_at);

        CREATE TABLE IF NOT EXISTS analysis_sessions (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          trace_id TEXT NOT NULL,
          created_by TEXT,
          provider_snapshot_id TEXT,
          title TEXT,
          visibility TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (trace_id) REFERENCES trace_assets(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (provider_snapshot_id) REFERENCES provider_snapshots(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_analysis_sessions_owner_guard
          ON analysis_sessions(tenant_id, workspace_id, id);
        CREATE INDEX IF NOT EXISTS idx_analysis_sessions_trace
          ON analysis_sessions(tenant_id, workspace_id, trace_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_analysis_sessions_status
          ON analysis_sessions(tenant_id, workspace_id, status, updated_at);

        CREATE TABLE IF NOT EXISTS analysis_runs (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          question TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          error_json TEXT,
          FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES analysis_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_analysis_runs_session
          ON analysis_runs(session_id, started_at);
        CREATE INDEX IF NOT EXISTS idx_analysis_runs_status
          ON analysis_runs(tenant_id, workspace_id, status, started_at);

        CREATE TABLE IF NOT EXISTS agent_events (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          run_id TEXT NOT NULL,
          cursor INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE,
          UNIQUE (run_id, cursor)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_events_replay
          ON agent_events(run_id, cursor);
        CREATE INDEX IF NOT EXISTS idx_agent_events_owner_guard
          ON agent_events(tenant_id, workspace_id, run_id, cursor);
      `);
    },
  },
];

export function applyEnterpriseMinimalSchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS enterprise_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(
    db.prepare<unknown[], { version: number }>(
      'SELECT version FROM enterprise_schema_migrations',
    ).all().map(row => row.version),
  );
  for (const step of MIGRATIONS) {
    if (applied.has(step.version)) continue;
    const tx = db.transaction(() => {
      step.up(db);
      db.prepare(
        'INSERT INTO enterprise_schema_migrations (version, applied_at) VALUES (?, ?)',
      ).run(step.version, Date.now());
    });
    tx();
  }
}
