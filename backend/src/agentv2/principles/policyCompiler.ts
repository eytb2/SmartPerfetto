import {
  CompiledPolicy,
  ConditionOperator,
  DecisionContext,
  OperationPolicy,
  PrincipleCondition,
  PrincipleDefinition,
  PrincipleEffect,
  PrincipleOutcome,
} from '../contracts/policy';

const DEFAULT_ALLOWED_DOMAINS = [
  'frame',
  'cpu',
  'binder',
  'memory',
  'startup',
  'interaction',
  'anr',
  'system',
  'gpu',
  'surfaceflinger',
  'input',
  'art',
  'timeline',
];

const OUTCOME_PRIORITY: Record<PrincipleOutcome, number> = {
  allow: 1,
  require_more_evidence: 2,
  require_approval: 3,
  deny: 4,
};

export function compileOperationPolicy(
  context: DecisionContext,
  principles: PrincipleDefinition[]
): CompiledPolicy {
  const policy = createBaseOperationPolicy(context);
  const matchedPrincipleIds: string[] = [];
  const reasonCodes: string[] = [];
  let decisionFloor: PrincipleOutcome = 'allow';

  const activePrinciples = principles
    .filter(principle => principle.status === 'active')
    .sort((a, b) => b.priority - a.priority);

  for (const principle of activePrinciples) {
    if (!matchesScope(context.mode, principle.scope)) continue;
    if (!matchesConditions(context, principle.conditions)) continue;

    matchedPrincipleIds.push(principle.id);
    reasonCodes.push(`principle.${principle.id}.matched`);

    for (const effect of principle.effects) {
      const result = applyEffect(policy, effect, decisionFloor);
      decisionFloor = strongerOutcome(decisionFloor, result.decisionFloor);
      reasonCodes.push(...result.reasonCodes);
    }
  }

  finalizePolicy(policy);

  return {
    policy,
    matchedPrincipleIds,
    reasonCodes: unique(reasonCodes),
    decisionFloor,
  };
}

export function createBaseOperationPolicy(context: DecisionContext): OperationPolicy {
  const requestedDomains = normalizeDomains(context.requestedDomains);
  const allowedDomains = requestedDomains.length > 0
    ? requestedDomains
    : [...DEFAULT_ALLOWED_DOMAINS];

  const maxStepsByMode = {
    initial: 6,
    clarify: 3,
    compare: 6,
    extend: 5,
    drill_down: 4,
  } as const;

  return {
    allowedDomains,
    requiredDomains: [],
    blockedDomains: [],
    minEvidenceBeforeConclusion: 2,
    maxOperationSteps: maxStepsByMode[context.mode],
    requireApprovalForActions: [],
    forceReferencedEntityFocus: context.mode === 'drill_down',
    contradictionPriorityBoost: 0,
  };
}

function applyEffect(
  policy: OperationPolicy,
  effect: PrincipleEffect,
  currentDecisionFloor: PrincipleOutcome
): { decisionFloor: PrincipleOutcome; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  let decisionFloor = currentDecisionFloor;

  switch (effect.type) {
    case 'require_domain':
      if (effect.domain) {
        policy.requiredDomains.push(effect.domain);
        policy.allowedDomains.push(effect.domain);
        reasonCodes.push(`effect.require_domain.${effect.domain}`);
      }
      break;
    case 'block_domain':
      if (effect.domain) {
        policy.blockedDomains.push(effect.domain);
        reasonCodes.push(`effect.block_domain.${effect.domain}`);
      }
      break;
    case 'set_min_evidence_before_conclusion':
      if (typeof effect.minEvidence === 'number') {
        policy.minEvidenceBeforeConclusion = Math.max(
          policy.minEvidenceBeforeConclusion,
          Math.max(0, Math.floor(effect.minEvidence))
        );
        reasonCodes.push(`effect.min_evidence.${policy.minEvidenceBeforeConclusion}`);
      }
      break;
    case 'set_max_operation_steps':
      if (typeof effect.maxSteps === 'number') {
        policy.maxOperationSteps = Math.min(
          policy.maxOperationSteps,
          Math.max(1, Math.floor(effect.maxSteps))
        );
        reasonCodes.push(`effect.max_steps.${policy.maxOperationSteps}`);
      }
      break;
    case 'require_approval_for_action':
      if (effect.action) {
        policy.requireApprovalForActions.push(effect.action);
        reasonCodes.push(`effect.require_approval_action.${effect.action}`);
      }
      break;
    case 'force_focus_on_referenced_entities':
      if (typeof effect.focus === 'boolean') {
        policy.forceReferencedEntityFocus = effect.focus;
        reasonCodes.push(`effect.force_focus.${String(effect.focus)}`);
      }
      break;
    case 'set_contradiction_priority_boost':
      if (typeof effect.boost === 'number') {
        policy.contradictionPriorityBoost = Math.max(
          policy.contradictionPriorityBoost,
          Math.max(0, Math.floor(effect.boost))
        );
        reasonCodes.push(`effect.contradiction_boost.${policy.contradictionPriorityBoost}`);
      }
      break;
    case 'set_decision_floor':
      if (effect.outcome) {
        decisionFloor = strongerOutcome(decisionFloor, effect.outcome);
        reasonCodes.push(`effect.decision_floor.${effect.outcome}`);
      }
      break;
    default:
      break;
  }

  return {
    decisionFloor,
    reasonCodes,
  };
}

function finalizePolicy(policy: OperationPolicy): void {
  policy.allowedDomains = unique(policy.allowedDomains).filter(
    domain => !policy.blockedDomains.includes(domain)
  );
  policy.requiredDomains = unique(policy.requiredDomains).filter(
    domain => !policy.blockedDomains.includes(domain)
  );
  policy.blockedDomains = unique(policy.blockedDomains);
  policy.requireApprovalForActions = unique(policy.requireApprovalForActions);
}

function matchesScope(mode: DecisionContext['mode'], scopes: PrincipleDefinition['scope']): boolean {
  return scopes.includes('global') || scopes.includes(mode);
}

function matchesConditions(context: DecisionContext, conditions: PrincipleCondition[]): boolean {
  if (conditions.length === 0) return true;

  for (const condition of conditions) {
    if (!matchesCondition(context, condition)) {
      return false;
    }
  }

  return true;
}

function matchesCondition(context: DecisionContext, condition: PrincipleCondition): boolean {
  const actualValue = getConditionFieldValue(context, condition.field);
  return compareCondition(actualValue, condition.operator, condition.value);
}

function getConditionFieldValue(
  context: DecisionContext,
  field: PrincipleCondition['field']
): string | number | string[] {
  switch (field) {
    case 'mode':
      return context.mode;
    case 'contradictionCount':
      return context.contradictionCount;
    case 'evidenceCount':
      return context.evidenceCount;
    case 'requestedDomainCount':
      return context.requestedDomains.length;
    case 'turnIndex':
      return context.turnIndex;
    case 'requestedDomains':
      return context.requestedDomains;
    case 'requestedActions':
      return context.requestedActions;
    default:
      return '';
  }
}

function compareCondition(
  actualValue: string | number | string[],
  operator: ConditionOperator,
  expectedValue: string | number | string[]
): boolean {
  switch (operator) {
    case 'eq':
      return actualValue === expectedValue;
    case 'neq':
      return actualValue !== expectedValue;
    case 'gt':
      return isNumber(actualValue) && isNumber(expectedValue) && actualValue > expectedValue;
    case 'gte':
      return isNumber(actualValue) && isNumber(expectedValue) && actualValue >= expectedValue;
    case 'lt':
      return isNumber(actualValue) && isNumber(expectedValue) && actualValue < expectedValue;
    case 'lte':
      return isNumber(actualValue) && isNumber(expectedValue) && actualValue <= expectedValue;
    case 'in':
      return Array.isArray(expectedValue) && expectedValue.includes(String(actualValue));
    case 'not_in':
      return Array.isArray(expectedValue) && !expectedValue.includes(String(actualValue));
    case 'includes':
      return Array.isArray(actualValue) && actualValue.includes(String(expectedValue));
    case 'not_includes':
      return Array.isArray(actualValue) && !actualValue.includes(String(expectedValue));
    default:
      return false;
  }
}

function strongerOutcome(current: PrincipleOutcome, candidate: PrincipleOutcome): PrincipleOutcome {
  return OUTCOME_PRIORITY[candidate] > OUTCOME_PRIORITY[current] ? candidate : current;
}

function normalizeDomains(domains: string[]): string[] {
  return unique(
    domains
      .map(domain => String(domain || '').trim())
      .filter(domain => domain.length > 0)
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
