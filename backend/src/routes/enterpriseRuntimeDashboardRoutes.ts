// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import express from 'express';
import { authenticate, requireRequestContext } from '../middleware/auth';
import { hasRbacPermission, sendForbidden } from '../services/rbac';
import {
  buildEnterpriseRuntimeDashboard,
  type EnterpriseRuntimeDashboardDependencies,
} from '../services/enterpriseRuntimeDashboardService';

export function createEnterpriseRuntimeDashboardRoutes(
  deps: EnterpriseRuntimeDashboardDependencies = {},
): express.Router {
  const router = express.Router();

  router.use(authenticate);
  router.use((req, res, next) => {
    const context = requireRequestContext(req);
    if (!hasRbacPermission(context, 'runtime:manage')) {
      sendForbidden(res, 'Runtime dashboard requires runtime:manage permission');
      return;
    }
    next();
  });

  router.get('/', (req, res) => {
    const context = requireRequestContext(req);
    res.json(buildEnterpriseRuntimeDashboard(context, deps));
  });

  return router;
}

export default createEnterpriseRuntimeDashboardRoutes();
