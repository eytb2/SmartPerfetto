// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Phase 0.1 of v2.1 — guarantee that `phaseHintsRenderer` and
 * `strategyFingerprint` agree on what "the same hint" means. Before this
 * phase the two modules used different canonical forms, so a freshly-
 * rendered auto-patch's stored fingerprint never matched the drift-
 * detection hash for the same hint, and every newly-landed `auto_*`
 * hint was reported as `patch_changed` immediately after merge.
 */

import { describe, it, expect } from '@jest/globals';
import { computeHintFingerprint } from '../hintFingerprint';
import { renderPhaseHint, type PhaseHintProposal } from '../phaseHintsRenderer';
import { computePatchFingerprint } from '../strategyFingerprint';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('computeHintFingerprint', () => {
  it('produces a 16-char hex hash', () => {
    const fp = computeHintFingerprint({
      keywords: ['vsync', 'vrr'],
      constraints: 'invoke vsync_dynamics_analysis first',
      criticalTools: ['vsync_dynamics_analysis'],
      critical: true,
    });
    expect(fp).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is stable across cosmetic differences', () => {
    const a = computeHintFingerprint({
      keywords: ['vsync', 'vrr'],
      constraints: 'invoke vsync_dynamics_analysis first',
      criticalTools: ['vsync_dynamics_analysis'],
      critical: true,
    });
    const b = computeHintFingerprint({
      keywords: ['VRR', 'VSYNC'],
      constraints: '  invoke vsync_dynamics_analysis first  ',
      criticalTools: ['  vsync_dynamics_analysis '],
      critical: true,
    });
    expect(a).toBe(b);
  });

  it('differs when `critical` flips', () => {
    const base = {
      keywords: ['x'],
      constraints: 'y',
      criticalTools: ['z'],
      critical: true,
    };
    expect(computeHintFingerprint(base)).not.toBe(
      computeHintFingerprint({ ...base, critical: false }),
    );
  });
});

describe('renderer / strategyFingerprint agree on identity', () => {
  /**
   * Render a real auto-patch via the templates dir and verify that:
   *  1. the renderer's reported `patchFingerprint`
   *  2. the strategyFingerprint computed from the same canonical fields
   * are byte-equal. Without Phase 0.1 these used different canonical
   * forms and produced different hashes.
   */
  it('renderer.patchFingerprint matches strategyFingerprint.computePatchFingerprint for the same hint', () => {
    const tmpTemplatesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-hint-tpl-'));
    try {
      fs.writeFileSync(
        path.join(tmpTemplatesDir, 'misdiagnosis_vsync_vrr.template.yaml'),
        'id: placeholder\n',
      );
      const proposal: PhaseHintProposal = {
        failureCategoryEnum: 'misdiagnosis_vsync_vrr',
        evidenceSummary: 'Observed false positive in 3 sessions',
        candidateKeywords: ['workload heavy', 'fallback'],
        candidateConstraints: 'Do not classify as workload_heavy without IO peer evidence',
        candidateCriticalTools: ['blocking_chain_analysis'],
      };
      const result = renderPhaseHint(proposal, { templatesDir: tmpTemplatesDir });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const fingerprintFromHintShape = computePatchFingerprint({
        id: result.phaseHintId,
        keywords: proposal.candidateKeywords,
        constraints: proposal.candidateConstraints,
        criticalTools: proposal.candidateCriticalTools,
        critical: false,
      });
      expect(result.patchFingerprint).toBe(fingerprintFromHintShape);
    } finally {
      fs.rmSync(tmpTemplatesDir, { recursive: true, force: true });
    }
  });
});
