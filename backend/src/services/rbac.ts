// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type { Response } from 'express';
import type { RequestContext } from '../middleware/auth';
import {
  isOwnedByContext,
  normalizeResourceOwner,
  type ResourceOwnerFields,
} from './resourceOwnership';

export type RbacPermission =
  | 'trace:read'
  | 'trace:write'
  | 'trace:download'
  | 'trace:delete_own'
  | 'trace:delete_any'
  | 'agent:run'
  | 'report:read'
  | 'report:delete'
  | 'provider:manage_workspace'
  | 'provider:manage_org'
  | 'audit:read'
  | 'runtime:manage';

const ROLE_PERMISSIONS: Record<string, RbacPermission[]> = {
  viewer: ['trace:read', 'report:read'],
  analyst: [
    'trace:read',
    'trace:write',
    'trace:download',
    'trace:delete_own',
    'agent:run',
    'report:read',
  ],
  workspace_admin: [
    'trace:read',
    'trace:write',
    'trace:download',
    'trace:delete_own',
    'trace:delete_any',
    'agent:run',
    'report:read',
    'report:delete',
    'provider:manage_workspace',
    'audit:read',
    'runtime:manage',
  ],
  org_admin: [
    'trace:read',
    'trace:write',
    'trace:download',
    'trace:delete_own',
    'trace:delete_any',
    'agent:run',
    'report:read',
    'report:delete',
    'provider:manage_workspace',
    'provider:manage_org',
    'audit:read',
    'runtime:manage',
  ],
};

const SCOPE_IMPLICATIONS: Partial<Record<RbacPermission, string[]>> = {
  'trace:delete_own': ['trace:write', 'trace:delete'],
  'trace:delete_any': ['trace:delete:any'],
  'report:delete': ['report:write'],
};

export function hasRbacPermission(context: RequestContext, permission: RbacPermission): boolean {
  if (context.scopes.includes('*')) return true;
  if (context.scopes.includes(permission)) return true;
  if (SCOPE_IMPLICATIONS[permission]?.some(scope => context.scopes.includes(scope))) return true;
  return context.roles.some(role => ROLE_PERMISSIONS[role]?.includes(permission));
}

export function sharesWorkspaceWithContext(
  resource: ResourceOwnerFields | null | undefined,
  context: RequestContext,
): boolean {
  const owner = normalizeResourceOwner(resource);
  return owner.tenantId === context.tenantId && owner.workspaceId === context.workspaceId;
}

export function canReadTraceResource(
  resource: ResourceOwnerFields | null | undefined,
  context: RequestContext,
): boolean {
  return sharesWorkspaceWithContext(resource, context) && hasRbacPermission(context, 'trace:read');
}

export function canDownloadTraceResource(
  resource: ResourceOwnerFields | null | undefined,
  context: RequestContext,
): boolean {
  return sharesWorkspaceWithContext(resource, context)
    && (hasRbacPermission(context, 'trace:download') || hasRbacPermission(context, 'trace:read'));
}

export function canDeleteTraceResource(
  resource: ResourceOwnerFields | null | undefined,
  context: RequestContext,
): boolean {
  if (!sharesWorkspaceWithContext(resource, context)) return false;
  if (hasRbacPermission(context, 'trace:delete_any')) return true;
  return isOwnedByContext(resource, context) && hasRbacPermission(context, 'trace:delete_own');
}

export function canReadReportResource(
  resource: ResourceOwnerFields | null | undefined,
  context: RequestContext,
): boolean {
  return sharesWorkspaceWithContext(resource, context) && hasRbacPermission(context, 'report:read');
}

export function canDeleteReportResource(
  resource: ResourceOwnerFields | null | undefined,
  context: RequestContext,
): boolean {
  if (!sharesWorkspaceWithContext(resource, context)) return false;
  if (hasRbacPermission(context, 'report:delete')) return true;
  return isOwnedByContext(resource, context) && hasRbacPermission(context, 'report:delete');
}

export function sendForbidden(res: Response, details = 'Forbidden'): Response {
  return res.status(403).json({
    success: false,
    error: 'Forbidden',
    details,
  });
}
