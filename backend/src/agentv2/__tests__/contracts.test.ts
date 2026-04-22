// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import {
  assertOperationPlan,
  createDefaultStopCriteria,
  isOperationPlan,
} from '../contracts/runtime';
import {
  isDecisionContext,
  isPrincipleDefinition,
  isSoulProfile,
} from '../contracts/policy';
import { SMART_PERFETTO_SOUL_PROFILE } from '../soul/soulProfile';

describe('agentv2 contracts', () => {
  it('validates operation plan payloads', () => {
    const plan = {
      id: 'plan-1',
      mode: 'initial',
      objective: 'Analyze scrolling jank root causes',
      targets: [{ domain: 'frame', reason: 'primary rendering bottleneck' }],
      steps: [
        {
          id: 'step-collect',
          kind: 'collect_evidence',
          objective: 'Collect frame and scheduling evidence',
          domains: ['frame', 'cpu'],
          requiredEvidence: ['ev-frame-overview'],
          dependsOn: [],
        },
        {
          id: 'step-conclude',
          kind: 'conclude',
          objective: 'Conclude root cause with evidence links',
          domains: ['frame'],
          requiredEvidence: ['ev-frame-overview'],
          dependsOn: ['step-collect'],
        },
      ],
      stopCriteria: createDefaultStopCriteria('initial'),
    };

    expect(isOperationPlan(plan)).toBe(true);
    expect(assertOperationPlan(plan).id).toBe('plan-1');
  });

  it('rejects invalid operation plan payloads', () => {
    const invalidPlan = {
      id: 'plan-2',
      mode: 'invalid-mode',
      objective: 'bad payload',
      targets: [],
      steps: [],
      stopCriteria: createDefaultStopCriteria('initial'),
    };

    expect(isOperationPlan(invalidPlan)).toBe(false);
    expect(() => assertOperationPlan(invalidPlan)).toThrow('Invalid OperationPlan payload');
  });

  it('validates soul profile and decision context payloads', () => {
    const context = {
      sessionId: 's1',
      traceId: 't1',
      turnIndex: 0,
      mode: 'drill_down',
      userGoal: 'deep dive frame 123',
      requestedDomains: ['frame'],
      requestedActions: [],
      referencedEntities: [{ type: 'frame', id: 123 }],
      coverageDomains: ['frame'],
      evidenceCount: 2,
      contradictionCount: 0,
    };

    const principle = {
      id: 'p1',
      version: 1,
      title: 'test',
      description: 'test principle',
      scope: ['global'],
      status: 'active',
      priority: 10,
      conditions: [],
      effects: [{ type: 'set_min_evidence_before_conclusion', minEvidence: 2 }],
    };

    expect(isSoulProfile(SMART_PERFETTO_SOUL_PROFILE)).toBe(true);
    expect(isDecisionContext(context)).toBe(true);
    expect(isPrincipleDefinition(principle)).toBe(true);
  });
});
