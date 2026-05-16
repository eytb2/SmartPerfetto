// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

export type ProcessIdentityStatus = 'verified' | 'ambiguous' | 'unresolved' | 'not_found';

export type SkillIdentityPolicy = 'none' | 'exempt' | 'verify_if_present' | 'required';

export type SkillIdentityRewriteTarget = 'recommended_process_name_param' | 'upid';

export interface SkillIdentityConfig {
  policy: SkillIdentityPolicy;
  scope?: 'process';
  aliases?: string[];
  rewriteTo?: SkillIdentityRewriteTarget;
  minConfidence?: number;
}

export interface ProcessIdentityTarget {
  requestedName?: string;
  threadName?: string;
  upid?: number;
  pid?: number;
  startTs?: string | number;
  endTs?: string | number;
}

export interface ProcessIdentityCandidate {
  rank: number;
  confidenceScore: number;
  rawStatus?: string;
  canonicalPackageName?: string;
  recommendedProcessNameParam?: string;
  upid?: number;
  pid?: number;
  processName?: string;
  metadataProcessName?: string;
  packageName?: string;
  cmdline?: string;
  targetMatchSources?: string;
  supportingSources?: string;
  identityWarning?: string;
}

export interface ProcessIdentityResolution {
  status: ProcessIdentityStatus;
  requestedName?: string;
  canonicalPackageName?: string;
  recommendedProcessNameParam?: string;
  upids: number[];
  confidenceScore: number;
  rawStatus?: string;
  evidenceSources: string[];
  warnings: string[];
  candidates: ProcessIdentityCandidate[];
  resolverError?: string;
}

export const DEFAULT_PROCESS_IDENTITY_ALIASES = [
  'package',
  'process_name',
  'package_name',
  'target_package',
  'app_package',
  'packageName',
  'processName',
];
