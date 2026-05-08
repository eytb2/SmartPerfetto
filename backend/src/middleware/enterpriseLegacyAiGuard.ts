// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type { NextFunction, Request, Response } from 'express';
import { resolveFeatureConfig } from '../config';

export const ENTERPRISE_LEGACY_AI_DISABLED_ERROR = 'disabled_in_enterprise_mode';
export const ENTERPRISE_LEGACY_AI_DISABLED_CODE = 'LEGACY_AI_DISABLED_IN_ENTERPRISE_MODE';

export function rejectLegacyAiInEnterpriseMode(surface: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!resolveFeatureConfig().enterprise) {
      next();
      return;
    }

    res.status(404).json({
      success: false,
      error: ENTERPRISE_LEGACY_AI_DISABLED_ERROR,
      code: ENTERPRISE_LEGACY_AI_DISABLED_CODE,
      details: `${surface} is disabled in enterprise mode; use ProviderSnapshot-backed agent runtime APIs instead.`,
    });
  };
}
