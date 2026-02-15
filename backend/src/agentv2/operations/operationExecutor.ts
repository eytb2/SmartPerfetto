import type { AnalysisResult } from '../../agent/core/orchestratorTypes';
import type { StreamingUpdate } from '../../agent/types';
import type { DecisionContext, PrincipleDecision } from '../contracts/policy';
import type { OperationPlan } from '../contracts/runtime';
import { ApprovalController } from './approvalController';

export interface OperationExecutorInput {
  query: string;
  sessionId: string;
  traceId: string;
  context: DecisionContext;
  decision: PrincipleDecision;
  plan: OperationPlan;
  analyzeWithRuntimeEngine: () => Promise<AnalysisResult>;
  emitUpdate: (update: StreamingUpdate) => void;
}

export interface OperationExecutorOutput {
  result: AnalysisResult;
  approvalRequired: boolean;
}

export class OperationExecutor {
  private readonly approvalController: ApprovalController;

  constructor(approvalController?: ApprovalController) {
    this.approvalController = approvalController || new ApprovalController();
  }

  async execute(input: OperationExecutorInput): Promise<OperationExecutorOutput> {
    input.emitUpdate({
      type: 'progress',
      content: {
        phase: 'analysis_plan',
        mode: input.plan.mode,
        planId: input.plan.id,
        steps: input.plan.steps.length,
      },
      timestamp: Date.now(),
      id: `plan.${input.plan.id}`,
    });

    const approval = this.approvalController.evaluate(input.decision, input.context);
    if (approval.required) {
      input.emitUpdate({
        type: 'intervention_required',
        content: {
          interventionId: approval.interventionId,
          type: 'validation_required',
          options: [
            {
              id: 'approve_principle_flow',
              label: 'Approve',
              description: 'Continue with principle-constrained flow',
              action: 'continue',
              recommended: true,
            },
            {
              id: 'abort_principle_flow',
              label: 'Abort',
              description: 'Abort analysis',
              action: 'abort',
            },
          ],
          context: {
            confidence: 0.5,
            elapsedTimeMs: 0,
            roundsCompleted: 0,
            progressSummary: input.context.userGoal,
            triggerReason: 'Principle policy requires approval',
            findingsCount: 0,
          },
          timeout: 60000,
        },
        timestamp: Date.now(),
        id: `intervention.${approval.interventionId}`,
      });
    }

    if (input.decision.outcome === 'deny') {
      return {
        approvalRequired: approval.required,
        result: {
          sessionId: input.sessionId,
          success: false,
          findings: [],
          hypotheses: [],
          conclusion: `Analysis denied by principles: ${input.decision.reasonCodes.join(', ')}`,
          confidence: 0,
          rounds: 0,
          totalDurationMs: 0,
        },
      };
    }

    const result = await input.analyzeWithRuntimeEngine();
    return {
      approvalRequired: approval.required,
      result,
    };
  }

  getApprovalController(): ApprovalController {
    return this.approvalController;
  }
}
