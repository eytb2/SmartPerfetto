// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { resolveFeatureConfig } from '../config';
import type { RequestContext } from '../middleware/auth';
import { openEnterpriseDb } from './enterpriseDb';

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

export interface EnterpriseRequestContextAuditInput {
  action: string;
  resourceType: string;
  resourceId?: string;
  workspaceId?: string | null;
  metadata?: Record<string, unknown>;
}

function ensureAuditGraph(db: Database.Database, input: EnterpriseAuditInput): void {
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, status, plan, created_at, updated_at)
    VALUES (?, ?, 'active', 'enterprise', ?, ?)
  `).run(input.tenantId, input.tenantId, now, now);

  if (input.workspaceId) {
    db.prepare(`
      INSERT OR IGNORE INTO workspaces (id, tenant_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.workspaceId, input.tenantId, input.workspaceId, now, now);
  }

  if (input.actorUserId) {
    db.prepare(`
      INSERT OR IGNORE INTO users (id, tenant_id, email, display_name, idp_subject, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.actorUserId,
      input.tenantId,
      `${input.actorUserId}@audit.local`,
      input.actorUserId,
      `audit:${input.tenantId}:${input.actorUserId}`,
      now,
      now,
    );
  }
}

export function recordEnterpriseAuditEvent(
  db: Database.Database,
  input: EnterpriseAuditInput,
): void {
  ensureAuditGraph(db, input);
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

export function recordEnterpriseAuditEventForContext(
  context: RequestContext,
  input: EnterpriseRequestContextAuditInput,
): boolean {
  if (!resolveFeatureConfig().enterprise) return false;

  const db = openEnterpriseDb();
  try {
    recordEnterpriseAuditEvent(db, {
      tenantId: context.tenantId,
      workspaceId: input.workspaceId === undefined ? context.workspaceId : input.workspaceId ?? undefined,
      actorUserId: context.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata,
    });
    return true;
  } catch (error) {
    console.warn('[EnterpriseAudit] Failed to record audit event:', (error as Error).message);
    return false;
  } finally {
    db.close();
  }
}

export function listEnterpriseAuditEvents(db: Database.Database): EnterpriseAuditRow[] {
  return db.prepare<unknown[], EnterpriseAuditRow>(`
    SELECT action, resource_type, resource_id, tenant_id, workspace_id, actor_user_id
    FROM audit_events
    ORDER BY created_at ASC
  `).all();
}
