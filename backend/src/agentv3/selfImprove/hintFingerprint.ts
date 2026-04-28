// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Shared canonical-form fingerprint for `phase_hints` entries.
 *
 * Before Phase 0.1 of v2.1, two modules computed `patchFingerprint`
 * with different canonical forms:
 *
 *  - `phaseHintsRenderer.computePatchFingerprint` hashed
 *    `{category, keywords, constraints, criticalTools}` — no `id`,
 *    no `critical`.
 *  - `strategyFingerprint.computePatchFingerprint` hashed
 *    `{id, keywords, constraints, criticalTools, critical}` — with both.
 *
 * Result: a freshly-rendered auto-patch's stored fingerprint never
 * matched the drift-detection hash for the same hint, so every newly-
 * landed `auto_*` hint was reported as `patch_changed` immediately
 * after merge, defeating the supersede pipeline.
 *
 * The shared canonical here intentionally excludes `id` (it is derived
 * from the fingerprint, so including it would be circular) and the
 * renderer-specific `category` (which is folded into other fields like
 * keywords/constraints anyway). It keeps `critical` because that *is*
 * a semantic property of the hint that should differentiate two hints
 * with otherwise identical content.
 */

import { createHash } from 'crypto';

export interface CanonicalHintInput {
  keywords: ReadonlyArray<string>;
  constraints: string;
  criticalTools: ReadonlyArray<string>;
  critical: boolean;
}

/**
 * Compute a 16-char hex fingerprint of a phase_hint's canonical form.
 * Used by both `phaseHintsRenderer` (input identity / dedup) and
 * `strategyFingerprint` (drift detection of stored hints) so the two
 * sides agree on what "the same hint" means.
 */
export function computeHintFingerprint(input: CanonicalHintInput): string {
  const canonical = {
    keywords: [...input.keywords].map(s => s.trim().toLowerCase()).sort(),
    constraints: (input.constraints || '').trim(),
    criticalTools: [...input.criticalTools].map(s => s.trim().toLowerCase()).sort(),
    critical: input.critical === true,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').substring(0, 16);
}
