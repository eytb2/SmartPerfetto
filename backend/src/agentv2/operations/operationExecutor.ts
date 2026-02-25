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
        type: 'progress',
        content: {
          phase: 'intervention_required',
          interventionId: approval.interventionId,
          reason: 'Principle policy requires approval before execution',
        },
        timestamp: Date.now(),
        id: `intervention.wait.${approval.interventionId || Date.now()}`,
      });

      if (!approval.interventionId) {
        return {
          approvalRequired: true,
          result: {
            sessionId: input.sessionId,
            success: false,
            findings: [],
            hypotheses: [],
            conclusion: 'Approval required but intervention could not be initialized',
            confidence: 0,
            rounds: 0,
            totalDurationMs: 0,
          },
        };
      }

      const approved = await this.waitForApprovalDecision(approval.interventionId);
      if (!approved) {
        return {
          approvalRequired: true,
          result: {
            sessionId: input.sessionId,
            success: false,
            findings: [],
            hypotheses: [],
            conclusion: `Analysis aborted during approval step: ${input.decision.reasonCodes.join(', ')}`,
            confidence: 0,
            rounds: 0,
            totalDurationMs: 0,
          },
        };
      }
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

  private waitForApprovalDecision(interventionId: string): Promise<boolean> {
    const interventionController = this.approvalController.getInterventionController();

    return new Promise((resolve) => {
      const cleanup = () => {
        interventionController.off('intervention_resolved', onResolved);
        interventionController.off('intervention_cancelled', onCancelled);
      };

      const onResolved = (data: any) => {
        if (!data || data.interventionId !== interventionId) {
          return;
        }
        cleanup();
        const directiveAction = data.directive?.action;
        const action = typeof directiveAction === 'string' ? directiveAction : data.action;
        resolve(action !== 'abort');
      };

      const onCancelled = (data: any) => {
        if (!data || data.interventionId !== interventionId) {
          return;
        }
        cleanup();
        resolve(false);
      };

      interventionController.on('intervention_resolved', onResolved);
      interventionController.on('intervention_cancelled', onCancelled);
    });
  }
}
