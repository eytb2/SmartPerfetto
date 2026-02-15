import { OperationPlanner } from '../operations/operationPlanner';

describe('OperationPlanner', () => {
  const planner = new OperationPlanner();

  it('builds bounded drill-down plan from policy', () => {
    const plan = planner.buildPlan({
      context: {
        sessionId: 's1',
        traceId: 't1',
        turnIndex: 1,
        mode: 'drill_down',
        userGoal: 'deep dive frame 101',
        requestedDomains: ['frame', 'cpu'],
        requestedActions: ['drill_down'],
        referencedEntities: [{ type: 'frame', id: 101 }],
        coverageDomains: ['frame'],
        evidenceCount: 1,
        contradictionCount: 0,
      },
      policy: {
        allowedDomains: ['frame'],
        requiredDomains: ['frame'],
        blockedDomains: ['cpu'],
        minEvidenceBeforeConclusion: 3,
        maxOperationSteps: 3,
        requireApprovalForActions: [],
        forceReferencedEntityFocus: true,
        contradictionPriorityBoost: 0,
      },
    });

    expect(plan.mode).toBe('drill_down');
    expect(plan.steps.length).toBeLessThanOrEqual(3);
    expect(plan.targets.map(t => t.domain)).toEqual(['frame']);
    const conclusion = plan.steps.find(step => step.kind === 'conclude');
    expect(conclusion?.requiredEvidence.length).toBe(3);
  });
});
