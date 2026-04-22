// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { PrincipleEngine } from '../principles/principleEngine';

describe('PrincipleEngine', () => {
  const engine = new PrincipleEngine();

  it('enforces drill-down focus and tighter operation budget', () => {
    const decision = engine.decide({
      sessionId: 'session-1',
      traceId: 'trace-1',
      turnIndex: 1,
      mode: 'drill_down',
      userGoal: 'analyze frame 123 deeply',
      requestedDomains: ['frame', 'cpu'],
      requestedActions: [],
      referencedEntities: [{ type: 'frame', id: 123 }],
      coverageDomains: ['frame'],
      evidenceCount: 3,
      contradictionCount: 0,
    });

    expect(decision.policy.forceReferencedEntityFocus).toBe(true);
    expect(decision.policy.maxOperationSteps).toBeLessThanOrEqual(4);
    expect(decision.outcome).toBe('allow');
  });

  it('requires more evidence when contradictions exist', () => {
    const decision = engine.decide({
      sessionId: 'session-2',
      traceId: 'trace-2',
      turnIndex: 2,
      mode: 'initial',
      userGoal: 'find root cause',
      requestedDomains: ['frame', 'cpu'],
      requestedActions: [],
      referencedEntities: [],
      coverageDomains: ['frame'],
      evidenceCount: 5,
      contradictionCount: 1,
    });

    expect(decision.outcome).toBe('require_more_evidence');
    expect(decision.reasonCodes).toContain('policy.contradiction_investigation_required');
  });

  it('requires approval for broad scope expansion actions', () => {
    const decision = engine.decide({
      sessionId: 'session-3',
      traceId: 'trace-3',
      turnIndex: 0,
      mode: 'extend',
      userGoal: 'expand to many domains',
      requestedDomains: ['frame', 'cpu', 'memory', 'binder', 'gpu'],
      requestedActions: ['expand_scope'],
      referencedEntities: [],
      coverageDomains: ['frame'],
      evidenceCount: 4,
      contradictionCount: 0,
    });

    expect(decision.outcome).toBe('require_approval');
    expect(decision.reasonCodes).toContain('policy.approval_required_for_action');
  });
});
