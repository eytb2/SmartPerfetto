import type { DecisionContext, OperationPolicy } from '../contracts/policy';
import {
  createDefaultStopCriteria,
  OperationMode,
  OperationPlan,
  OperationStep,
} from '../contracts/runtime';

export interface OperationPlannerInput {
  context: DecisionContext;
  policy: OperationPolicy;
}

export class OperationPlanner {
  buildPlan(input: OperationPlannerInput): OperationPlan {
    const { context, policy } = input;
    const mode = context.mode;
    const domains = derivePlanDomains(context, policy);

    const steps = this.buildSteps(mode, domains, policy);
    const stopCriteria = {
      ...createDefaultStopCriteria(mode),
      maxSteps: Math.min(policy.maxOperationSteps, createDefaultStopCriteria(mode).maxSteps),
    };

    return {
      id: buildPlanId(context),
      mode,
      objective: context.userGoal,
      targets: domains.map(domain => ({ domain, reason: 'policy_selected_domain' })),
      steps,
      stopCriteria,
    };
  }

  private buildSteps(
    mode: OperationMode,
    domains: string[],
    policy: OperationPolicy
  ): OperationStep[] {
    const firstDomain = domains[0] || 'frame';
    const baseEvidence = [`ev.${firstDomain}.baseline`];

    const planByMode: Record<OperationMode, OperationStep[]> = {
      initial: [
        makeStep('collect_baseline', 'collect_evidence', 'Collect baseline evidence', domains, baseEvidence),
        makeStep('test_primary_hypothesis', 'test_hypothesis', 'Test primary root-cause hypothesis', domains, baseEvidence, ['collect_baseline']),
        makeStep('resolve_contradictions', 'resolve_contradiction', 'Resolve conflicting signals', domains, baseEvidence, ['test_primary_hypothesis']),
        makeStep('conclude', 'conclude', 'Generate conclusion with evidence chain', domains, baseEvidence, ['resolve_contradictions']),
      ],
      clarify: [
        makeStep('collect_supporting_evidence', 'collect_evidence', 'Collect evidence references for clarification', domains, baseEvidence),
        makeStep('explain_findings', 'explain_findings', 'Explain current findings and rationale', domains, baseEvidence, ['collect_supporting_evidence']),
        makeStep('conclude', 'conclude', 'Deliver concise clarification conclusion', domains, baseEvidence, ['explain_findings']),
      ],
      compare: [
        makeStep('collect_compare_baseline', 'collect_evidence', 'Collect baseline for compare targets', domains, baseEvidence),
        makeStep('compare_entities', 'compare_entities', 'Compare target entities under same metric basis', domains, baseEvidence, ['collect_compare_baseline']),
        makeStep('resolve_contradictions', 'resolve_contradiction', 'Resolve inconsistencies in comparison', domains, baseEvidence, ['compare_entities']),
        makeStep('conclude', 'conclude', 'Conclude comparative diagnosis', domains, baseEvidence, ['resolve_contradictions']),
      ],
      extend: [
        makeStep('collect_extension_evidence', 'collect_evidence', 'Collect evidence for extension scope', domains, baseEvidence),
        makeStep('test_extension_hypothesis', 'test_hypothesis', 'Test whether issue pattern extends', domains, baseEvidence, ['collect_extension_evidence']),
        makeStep('conclude', 'conclude', 'Conclude extension findings', domains, baseEvidence, ['test_extension_hypothesis']),
      ],
      drill_down: [
        makeStep('collect_drilldown_evidence', 'collect_evidence', 'Collect target entity deep evidence', domains, baseEvidence),
        makeStep('test_drilldown_hypothesis', 'test_hypothesis', 'Validate deep-dive hypothesis', domains, baseEvidence, ['collect_drilldown_evidence']),
        makeStep('conclude', 'conclude', 'Conclude drill-down root cause', domains, baseEvidence, ['test_drilldown_hypothesis']),
      ],
    };

    const candidate = planByMode[mode];
    const bounded = candidate.slice(0, Math.max(1, policy.maxOperationSteps));

    if (policy.minEvidenceBeforeConclusion > 0) {
      for (const step of bounded) {
        if (step.kind === 'conclude') {
          step.requiredEvidence = Array.from({ length: policy.minEvidenceBeforeConclusion }).map(
            (_, index) => `ev.required.${index + 1}`
          );
        }
      }
    }

    return bounded;
  }
}

function derivePlanDomains(context: DecisionContext, policy: OperationPolicy): string[] {
  const selected = policy.allowedDomains.length > 0 ? policy.allowedDomains : context.requestedDomains;
  const required = policy.requiredDomains;
  const blocked = new Set(policy.blockedDomains);

  const merged = [...selected, ...required]
    .map(domain => String(domain || '').trim())
    .filter(domain => domain.length > 0)
    .filter(domain => !blocked.has(domain));

  const unique = Array.from(new Set(merged));
  return unique.length > 0 ? unique : ['frame'];
}

function buildPlanId(context: DecisionContext): string {
  return `plan.${context.sessionId}.${context.turnIndex}.${context.mode}`;
}

function makeStep(
  id: string,
  kind: OperationStep['kind'],
  objective: string,
  domains: string[],
  requiredEvidence: string[],
  dependsOn: string[] = []
): OperationStep {
  return {
    id,
    kind,
    objective,
    domains,
    requiredEvidence,
    dependsOn,
  };
}
