// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import crypto from 'crypto';
import type Database from 'better-sqlite3';

export interface EnterpriseAuditInput {
  tenantId: string;
  workspaceId?: string;
  actorUserId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

export interface EnterpriseAuditRow {
  action: string;
  resource_type: string;
  resource_id: string | null;
  tenant_id: string;
  workspace_id: string | null;
  actor_user_id: string | null;
}

export function recordEnterpriseAuditEvent(
  db: Database.Database,
  input: EnterpriseAuditInput,
): void {
  db.prepare(`
    INSERT INTO audit_events
      (id, tenant_id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    input.tenantId,
    input.workspaceId ?? null,
    input.actorUserId ?? null,
    input.action,
    input.resourceType,
    input.resourceId ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    Date.now(),
  );
}

export function listEnterpriseAuditEvents(db: Database.Database): EnterpriseAuditRow[] {
  return db.prepare<unknown[], EnterpriseAuditRow>(`
    SELECT action, resource_type, resource_id, tenant_id, workspace_id, actor_user_id
    FROM audit_events
    ORDER BY created_at ASC
  `).all();
}
