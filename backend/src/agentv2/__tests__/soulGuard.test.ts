// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { createDefaultStopCriteria } from '../contracts/runtime';
import { evaluateSoulGuard } from '../soul/soulGuard';
import { SMART_PERFETTO_SOUL_PROFILE } from '../soul/soulProfile';

describe('SoulGuard', () => {
  const baseContext = {
    sessionId: 'session-1',
    traceId: 'trace-1',
    turnIndex: 0,
    mode: 'initial' as const,
    userGoal: 'analyze jank root cause',
    requestedDomains: ['frame'],
    requestedActions: [],
    referencedEntities: [],
    coverageDomains: [],
    evidenceCount: 0,
    contradictionCount: 0,
  };

  it('fails when conclusion appears before evidence collection', () => {
    const plan = {
      id: 'plan-invalid',
      mode: 'initial' as const,
      objective: 'invalid plan',
      targets: [{ domain: 'frame' }],
      steps: [
        {
          id: 'conclude-first',
          kind: 'conclude' as const,
          objective: 'conclude immediately',
          domains: ['frame'],
          requiredEvidence: ['ev-1'],
          dependsOn: [],
        },
      ],
      stopCriteria: createDefaultStopCriteria('initial'),
    };

    const result = evaluateSoulGuard(SMART_PERFETTO_SOUL_PROFILE, {
      context: baseContext,
      plan,
      claimedConfidence: 0.9,
    });

    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.code === 'soul.evidence_before_conclusion')).toBe(true);
    expect(result.violations.some(v => v.code === 'soul.overconfident_without_evidence')).toBe(true);
  });

  it('passes when plan is evidence-grounded and domain-bounded', () => {
    const plan = {
      id: 'plan-valid',
      mode: 'initial' as const,
      objective: 'valid plan',
      targets: [{ domain: 'frame' }, { domain: 'cpu' }],
      steps: [
        {
          id: 'collect',
          kind: 'collect_evidence' as const,
          objective: 'collect evidence',
          domains: ['frame', 'cpu'],
          requiredEvidence: ['ev-overview'],
          dependsOn: [],
        },
        {
          id: 'conclude',
          kind: 'conclude' as const,
          objective: 'conclude',
          domains: ['frame'],
          requiredEvidence: ['ev-overview'],
          dependsOn: ['collect'],
        },
      ],
      stopCriteria: createDefaultStopCriteria('initial'),
    };

    const result = evaluateSoulGuard(SMART_PERFETTO_SOUL_PROFILE, {
      context: { ...baseContext, evidenceCount: 3 },
      plan,
      claimedConfidence: 0.82,
    });

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});
