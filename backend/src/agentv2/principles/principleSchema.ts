import type { PrincipleDefinition } from '../contracts/policy';

export const DEFAULT_PRINCIPLES: PrincipleDefinition[] = [
  {
    id: 'evidence-first-conclusion',
    version: 1,
    title: 'Evidence First Conclusion',
    description: 'Require minimum evidence before allowing conclusion.',
    scope: ['global'],
    status: 'active',
    priority: 100,
    conditions: [],
    effects: [
      {
        type: 'set_min_evidence_before_conclusion',
        minEvidence: 3,
      },
    ],
  },
  {
    id: 'drilldown-focus-precision',
    version: 1,
    title: 'Drill-down Focus Precision',
    description: 'Drill-down must stay narrow and focus on referenced entities.',
    scope: ['drill_down'],
    status: 'active',
    priority: 95,
    conditions: [
      { field: 'mode', operator: 'eq', value: 'drill_down' },
    ],
    effects: [
      { type: 'force_focus_on_referenced_entities', focus: true },
      { type: 'set_max_operation_steps', maxSteps: 4 },
    ],
  },
  {
    id: 'clarify-is-explanation',
    version: 1,
    title: 'Clarify Is Explanation',
    description: 'Clarification should prioritize explanation over broad exploration.',
    scope: ['clarify'],
    status: 'active',
    priority: 90,
    conditions: [
      { field: 'mode', operator: 'eq', value: 'clarify' },
    ],
    effects: [
      { type: 'set_max_operation_steps', maxSteps: 3 },
    ],
  },
  {
    id: 'contradiction-resolution-first',
    version: 1,
    title: 'Contradiction Resolution First',
    description: 'When contradictions exist, do not finalize until more evidence is collected.',
    scope: ['global'],
    status: 'active',
    priority: 88,
    conditions: [
      { field: 'contradictionCount', operator: 'gt', value: 0 },
    ],
    effects: [
      { type: 'set_contradiction_priority_boost', boost: 2 },
      { type: 'set_decision_floor', outcome: 'require_more_evidence' },
    ],
  },
  {
    id: 'scope-expansion-needs-approval',
    version: 1,
    title: 'Scope Expansion Needs Approval',
    description: 'Large scope expansion should require explicit approval.',
    scope: ['initial', 'extend'],
    status: 'active',
    priority: 80,
    conditions: [
      { field: 'requestedDomainCount', operator: 'gt', value: 4 },
    ],
    effects: [
      { type: 'require_approval_for_action', action: 'expand_scope' },
      { type: 'set_decision_floor', outcome: 'require_approval' },
    ],
  },
];

export function createDefaultPrinciples(): PrincipleDefinition[] {
  return DEFAULT_PRINCIPLES.map(principle => ({
    ...principle,
    scope: [...principle.scope],
    conditions: principle.conditions.map(condition => ({
      ...condition,
      value: Array.isArray(condition.value) ? [...condition.value] : condition.value,
    })),
    effects: principle.effects.map(effect => ({ ...effect })),
  }));
}
