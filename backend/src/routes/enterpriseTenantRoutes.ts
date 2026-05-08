// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { Router, type Response } from 'express';

import { authenticate, requireRequestContext, type RequestContext } from '../middleware/auth';
import { openEnterpriseDb } from '../services/enterpriseDb';
import {
  createTenantTombstone,
  getTenantTombstone,
  purgeTenantNow,
  TenantPurgeBlockedError,
  TenantPurgeWindowError,
  type TenantPurgeProof,
} from '../services/enterpriseTenantLifecycleService';
import { sendForbidden } from '../services/rbac';

interface TenantPurgeJob {
  id: string;
  tenantId: string;
  status: 'running' | 'completed' | 'blocked' | 'failed';
  createdAt: number;
  completedAt?: number;
  proof?: TenantPurgeProof;
  blockers?: unknown[];
  error?: string;
}

const router = Router();
const tenantPurgeJobs = new Map<string, TenantPurgeJob>();

function canDeleteTenant(context: RequestContext): boolean {
  return context.scopes.includes('*')
    || context.scopes.includes('tenant:delete')
    || context.roles.includes('org_admin');
}

function requireTenantDeletePermission(context: RequestContext, res: Response): boolean {
  if (canDeleteTenant(context)) return true;
  sendForbidden(res, 'Tenant deletion requires org_admin or tenant:delete scope');
  return false;
}

function requireTenantConfirmation(body: unknown, tenantId: string): string | null {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  return input.confirmTenantId === tenantId ? null : 'confirmTenantId must match the request tenant';
}

router.use(authenticate);

router.post('/tombstone', (req, res) => {
  const context = requireRequestContext(req);
  if (!requireTenantDeletePermission(context, res)) return;
  const confirmationError = requireTenantConfirmation(req.body, context.tenantId);
  if (confirmationError) {
    return res.status(400).json({ success: false, error: confirmationError });
  }

  const db = openEnterpriseDb();
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const tombstone = createTenantTombstone(db, context, reason);
    res.status(202).json({
      success: true,
      tombstone,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to tombstone tenant',
    });
  } finally {
    db.close();
  }
});

router.get('/tombstone', (req, res) => {
  const context = requireRequestContext(req);
  if (!requireTenantDeletePermission(context, res)) return;

  const db = openEnterpriseDb();
  try {
    res.json({
      success: true,
      tombstone: getTenantTombstone(db, context.tenantId),
    });
  } finally {
    db.close();
  }
});

router.post('/purge', (req, res) => {
  const context = requireRequestContext(req);
  if (!requireTenantDeletePermission(context, res)) return;
  const confirmationError = requireTenantConfirmation(req.body, context.tenantId);
  if (confirmationError) {
    return res.status(400).json({ success: false, error: confirmationError });
  }

  const db = openEnterpriseDb();
  try {
    const tombstone = getTenantTombstone(db, context.tenantId);
    if (!tombstone) {
      return res.status(404).json({
        success: false,
        error: 'Tenant tombstone not found',
      });
    }
    if (tombstone.purgeAfter > Date.now()) {
      return res.status(409).json({
        success: false,
        code: 'TENANT_PURGE_WINDOW_ACTIVE',
        error: 'Tenant purge window has not elapsed',
        purgeAfter: tombstone.purgeAfter,
      });
    }
  } finally {
    db.close();
  }

  const jobId = `tenant-purge-${context.tenantId}-${Date.now()}`;
  const job: TenantPurgeJob = {
    id: jobId,
    tenantId: context.tenantId,
    status: 'running',
    createdAt: Date.now(),
  };
  tenantPurgeJobs.set(jobId, job);
  setImmediate(async () => {
    const jobDb = openEnterpriseDb();
    try {
      job.proof = await purgeTenantNow(jobDb, context);
      job.status = 'completed';
      job.completedAt = Date.now();
    } catch (error: any) {
      job.completedAt = Date.now();
      if (error instanceof TenantPurgeBlockedError) {
        job.status = 'blocked';
        job.blockers = error.blockers;
      } else if (error instanceof TenantPurgeWindowError) {
        job.status = 'failed';
        job.error = error.message;
      } else {
        job.status = 'failed';
        job.error = error.message || 'Tenant purge failed';
      }
    } finally {
      jobDb.close();
    }
  });

  res.status(202).json({
    success: true,
    jobId,
    status: job.status,
  });
});

router.get('/purge/:jobId', (req, res) => {
  const context = requireRequestContext(req);
  if (!requireTenantDeletePermission(context, res)) return;
  const job = tenantPurgeJobs.get(req.params.jobId);
  if (!job || job.tenantId !== context.tenantId) {
    return res.status(404).json({
      success: false,
      error: 'Tenant purge job not found',
    });
  }
  res.json({
    success: true,
    job,
  });
});

export function resetTenantPurgeJobsForTests(): void {
  tenantPurgeJobs.clear();
}

export default router;
