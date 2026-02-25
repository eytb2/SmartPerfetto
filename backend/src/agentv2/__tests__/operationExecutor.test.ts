import { describe, expect, it, jest } from '@jest/globals';
import { InterventionController } from '../../agent/core/interventionController';
import type { AnalysisResult } from '../../agent/core/orchestratorTypes';
import type { PrincipleDecision, DecisionContext } from '../contracts/policy';
import type { OperationPlan } from '../contracts/runtime';
import { ApprovalController } from '../operations/approvalController';
import { OperationExecutor } from '../operations/operationExecutor';

const baseContext: DecisionContext = {
  sessionId: 'session-1',
  traceId: 'trace-1',
  turnIndex: 1,
  mode: 'extend',
  userGoal: 'expand analysis scope',
  requestedDomains: ['frame', 'cpu'],
  requestedActions: ['expand_scope'],
  referencedEntities: [],
  coverageDomains: ['frame'],
  evidenceCount: 3,
  contradictionCount: 0,
};

const basePlan: OperationPlan = {
  id: 'plan-1',
  mode: 'extend',
  objective: 'expand analysis scope',
  targets: [{ domain: 'frame' }],
  steps: [
    {
      id: 'step-1',
      kind: 'collect_evidence',
      objective: 'collect more evidence',
      domains: ['frame'],
      requiredEvidence: [],
      dependsOn: [],
    },
  ],
  stopCriteria: {
    maxSteps: 3,
    maxRounds: 2,
    minConfidenceToConclude: 0.7,
    stopOnCriticalContradiction: true,
  },
};

const basePolicy = {
  allowedDomains: ['frame', 'cpu'],
  requiredDomains: [],
  blockedDomains: [],
  minEvidenceBeforeConclusion: 2,
  maxOperationSteps: 4,
  requireApprovalForActions: ['expand_scope'],
  forceReferencedEntityFocus: false,
  contradictionPriorityBoost: 0,
};

const successfulResult: AnalysisResult = {
  sessionId: 'session-1',
  success: true,
  findings: [],
  hypotheses: [],
  conclusion: 'ok',
  confidence: 0.8,
  rounds: 1,
  totalDurationMs: 10,
};

describe('OperationExecutor approval gating', () => {
  it('blocks execution until approval intervention is resolved', async () => {
    const interventionController = new InterventionController({
      confidenceThreshold: 0.5,
      timeoutThresholdMs: 120000,
      userResponseTimeoutMs: 60000,
      autoIntervention: true,
    });
    const executor = new OperationExecutor(new ApprovalController(interventionController));

    const analyzeWithRuntimeEngine = jest.fn(async () => successfulResult);
    const emitUpdate = jest.fn();

    const decision: PrincipleDecision = {
      outcome: 'require_approval',
      reasonCodes: ['policy.approval_required_for_action'],
      matchedPrincipleIds: ['p-1'],
      policy: basePolicy,
    };

    const executionPromise = executor.execute({
      query: 'analyze',
      sessionId: 'session-1',
      traceId: 'trace-1',
      context: baseContext,
      decision,
      plan: basePlan,
      analyzeWithRuntimeEngine,
      emitUpdate,
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(analyzeWithRuntimeEngine).not.toHaveBeenCalled();

    const pendingIntervention = interventionController.getPendingIntervention('session-1');
    expect(pendingIntervention).toBeDefined();

    interventionController.handleUserDecision({
      interventionId: pendingIntervention!.id,
      action: 'continue',
    });

    const execution = await executionPromise;
    expect(execution.approvalRequired).toBe(true);
    expect(analyzeWithRuntimeEngine).toHaveBeenCalledTimes(1);
    expect(execution.result.success).toBe(true);
  });

  it('returns aborted result when approval is rejected', async () => {
    const interventionController = new InterventionController({
      confidenceThreshold: 0.5,
      timeoutThresholdMs: 120000,
      userResponseTimeoutMs: 60000,
      autoIntervention: true,
    });
    const executor = new OperationExecutor(new ApprovalController(interventionController));

    const analyzeWithRuntimeEngine = jest.fn(async () => successfulResult);

    const decision: PrincipleDecision = {
      outcome: 'require_approval',
      reasonCodes: ['policy.approval_required_for_action'],
      matchedPrincipleIds: ['p-1'],
      policy: basePolicy,
    };

    const executionPromise = executor.execute({
      query: 'analyze',
      sessionId: 'session-1',
      traceId: 'trace-1',
      context: baseContext,
      decision,
      plan: basePlan,
      analyzeWithRuntimeEngine,
      emitUpdate: jest.fn(),
    });

    await new Promise((resolve) => setImmediate(resolve));
    const pendingIntervention = interventionController.getPendingIntervention('session-1');
    expect(pendingIntervention).toBeDefined();

    interventionController.handleUserDecision({
      interventionId: pendingIntervention!.id,
      action: 'abort',
    });

    const execution = await executionPromise;
    expect(execution.approvalRequired).toBe(true);
    expect(execution.result.success).toBe(false);
    expect(execution.result.conclusion).toContain('aborted during approval step');
    expect(analyzeWithRuntimeEngine).not.toHaveBeenCalled();
  });

  it('rejects execution when requested domains violate policy guardrails', async () => {
    const executor = new OperationExecutor(new ApprovalController(new InterventionController()));
    const analyzeWithRuntimeEngine = jest.fn(async () => successfulResult);

    const decision: PrincipleDecision = {
      outcome: 'allow',
      reasonCodes: ['policy.blocked_domain'],
      matchedPrincipleIds: ['p-guard'],
      policy: {
        ...basePolicy,
        blockedDomains: ['frame'],
      },
    };

    const execution = await executor.execute({
      query: 'analyze',
      sessionId: 'session-1',
      traceId: 'trace-1',
      context: baseContext,
      decision,
      plan: basePlan,
      analyzeWithRuntimeEngine,
      emitUpdate: jest.fn(),
    });

    expect(execution.result.success).toBe(false);
    expect(execution.result.conclusion).toContain('Policy blocked requested domains');
    expect(analyzeWithRuntimeEngine).not.toHaveBeenCalled();
  });

  it('enforces require_more_evidence when runtime returns no findings', async () => {
    const executor = new OperationExecutor(new ApprovalController(new InterventionController()));
    const analyzeWithRuntimeEngine = jest.fn(async () => successfulResult);

    const decision: PrincipleDecision = {
      outcome: 'require_more_evidence',
      reasonCodes: ['policy.insufficient_evidence'],
      matchedPrincipleIds: ['p-evidence'],
      policy: basePolicy,
    };

    const execution = await executor.execute({
      query: 'analyze',
      sessionId: 'session-1',
      traceId: 'trace-1',
      context: baseContext,
      decision,
      plan: basePlan,
      analyzeWithRuntimeEngine,
      emitUpdate: jest.fn(),
    });

    expect(execution.result.success).toBe(false);
    expect(execution.result.conclusion).toContain('requires more evidence');
    expect(analyzeWithRuntimeEngine).toHaveBeenCalledTimes(1);
  });
});
