import type { EntityReference, OperationMode } from './runtime';

export const PRINCIPLE_OUTCOMES = [
  'allow',
  'require_more_evidence',
  'require_approval',
  'deny',
] as const;

export type PrincipleOutcome = (typeof PRINCIPLE_OUTCOMES)[number];

export const PRINCIPLE_SCOPES = [
  'global',
  'initial',
  'clarify',
  'compare',
  'extend',
  'drill_down',
] as const;

export type PrincipleScope = (typeof PRINCIPLE_SCOPES)[number];

export const CONDITION_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'includes',
  'not_includes',
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const PRINCIPLE_EFFECT_TYPES = [
  'require_domain',
  'block_domain',
  'set_min_evidence_before_conclusion',
  'set_max_operation_steps',
  'require_approval_for_action',
  'force_focus_on_referenced_entities',
  'set_contradiction_priority_boost',
  'set_decision_floor',
] as const;

export type PrincipleEffectType = (typeof PRINCIPLE_EFFECT_TYPES)[number];

export const PRINCIPLE_STATUSES = [
  'active',
  'candidate',
  'disabled',
] as const;

export type PrincipleStatus = (typeof PRINCIPLE_STATUSES)[number];

export interface SoulConstraint {
  id: string;
  description: string;
  enforcement: 'hard' | 'soft';
  violationCode: string;
}

export interface SoulProfile {
  id: string;
  version: number;
  name: string;
  mission: string;
  domainBoundaries: string[];
  nonNegotiables: SoulConstraint[];
}

export interface SoulViolation {
  code: string;
  constraintId: string;
  message: string;
  severity: 'warning' | 'error';
}

export interface DecisionContext {
  sessionId: string;
  traceId: string;
  turnIndex: number;
  mode: OperationMode;
  userGoal: string;
  requestedDomains: string[];
  requestedActions: string[];
  referencedEntities: EntityReference[];
  coverageDomains: string[];
  evidenceCount: number;
  contradictionCount: number;
}

export interface OperationPolicy {
  allowedDomains: string[];
  requiredDomains: string[];
  blockedDomains: string[];
  minEvidenceBeforeConclusion: number;
  maxOperationSteps: number;
  requireApprovalForActions: string[];
  forceReferencedEntityFocus: boolean;
  contradictionPriorityBoost: number;
}

export type PrincipleConditionField =
  | 'mode'
  | 'contradictionCount'
  | 'evidenceCount'
  | 'requestedDomainCount'
  | 'turnIndex'
  | 'requestedDomains'
  | 'requestedActions';

export interface PrincipleCondition {
  field: PrincipleConditionField;
  operator: ConditionOperator;
  value: string | number | string[];
}

export interface PrincipleEffect {
  type: PrincipleEffectType;
  domain?: string;
  action?: string;
  minEvidence?: number;
  maxSteps?: number;
  focus?: boolean;
  boost?: number;
  outcome?: PrincipleOutcome;
}

export interface PrincipleDefinition {
  id: string;
  version: number;
  title: string;
  description: string;
  scope: PrincipleScope[];
  status: PrincipleStatus;
  priority: number;
  conditions: PrincipleCondition[];
  effects: PrincipleEffect[];
}

export interface CompiledPolicy {
  policy: OperationPolicy;
  matchedPrincipleIds: string[];
  reasonCodes: string[];
  decisionFloor: PrincipleOutcome;
}

export interface PrincipleDecision {
  outcome: PrincipleOutcome;
  reasonCodes: string[];
  matchedPrincipleIds: string[];
  policy: OperationPolicy;
}

export function isPrincipleOutcome(value: unknown): value is PrincipleOutcome {
  return typeof value === 'string' && (PRINCIPLE_OUTCOMES as readonly string[]).includes(value);
}

export function isSoulProfile(value: unknown): value is SoulProfile {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isFiniteNumber(value.version)) return false;
  if (!isNonEmptyString(value.name)) return false;
  if (!isNonEmptyString(value.mission)) return false;
  if (!isStringArray(value.domainBoundaries)) return false;
  if (!Array.isArray(value.nonNegotiables) || !value.nonNegotiables.every(isSoulConstraint)) return false;
  return true;
}

export function isDecisionContext(value: unknown): value is DecisionContext {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.sessionId)) return false;
  if (!isNonEmptyString(value.traceId)) return false;
  if (!isFiniteNumber(value.turnIndex)) return false;
  if (!isOperationModeLike(value.mode)) return false;
  if (!isNonEmptyString(value.userGoal)) return false;
  if (!isStringArray(value.requestedDomains)) return false;
  if (!isStringArray(value.requestedActions)) return false;
  if (!Array.isArray(value.referencedEntities)) return false;
  if (!isStringArray(value.coverageDomains)) return false;
  if (!isFiniteNumber(value.evidenceCount)) return false;
  if (!isFiniteNumber(value.contradictionCount)) return false;
  return true;
}

export function isOperationPolicy(value: unknown): value is OperationPolicy {
  if (!isRecord(value)) return false;
  if (!isStringArray(value.allowedDomains)) return false;
  if (!isStringArray(value.requiredDomains)) return false;
  if (!isStringArray(value.blockedDomains)) return false;
  if (!isFiniteNumber(value.minEvidenceBeforeConclusion)) return false;
  if (!isFiniteNumber(value.maxOperationSteps)) return false;
  if (!isStringArray(value.requireApprovalForActions)) return false;
  if (typeof value.forceReferencedEntityFocus !== 'boolean') return false;
  if (!isFiniteNumber(value.contradictionPriorityBoost)) return false;
  return true;
}

export function isPrincipleDefinition(value: unknown): value is PrincipleDefinition {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isFiniteNumber(value.version)) return false;
  if (!isNonEmptyString(value.title)) return false;
  if (!isNonEmptyString(value.description)) return false;
  if (!Array.isArray(value.scope) || !value.scope.every(isPrincipleScope)) return false;
  if (!isPrincipleStatus(value.status)) return false;
  if (!isFiniteNumber(value.priority)) return false;
  if (!Array.isArray(value.conditions) || !value.conditions.every(isPrincipleCondition)) return false;
  if (!Array.isArray(value.effects) || !value.effects.every(isPrincipleEffect)) return false;
  return true;
}

function isSoulConstraint(value: unknown): value is SoulConstraint {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.description)) return false;
  if (value.enforcement !== 'hard' && value.enforcement !== 'soft') return false;
  if (!isNonEmptyString(value.violationCode)) return false;
  return true;
}

function isPrincipleCondition(value: unknown): value is PrincipleCondition {
  if (!isRecord(value)) return false;
  if (!isPrincipleConditionField(value.field)) return false;
  if (!isConditionOperator(value.operator)) return false;
  if (!isValidConditionValue(value.value)) return false;
  return true;
}

function isPrincipleEffect(value: unknown): value is PrincipleEffect {
  if (!isRecord(value)) return false;
  if (!isPrincipleEffectType(value.type)) return false;
  if (value.domain !== undefined && !isNonEmptyString(value.domain)) return false;
  if (value.action !== undefined && !isNonEmptyString(value.action)) return false;
  if (value.minEvidence !== undefined && !isFiniteNumber(value.minEvidence)) return false;
  if (value.maxSteps !== undefined && !isFiniteNumber(value.maxSteps)) return false;
  if (value.focus !== undefined && typeof value.focus !== 'boolean') return false;
  if (value.boost !== undefined && !isFiniteNumber(value.boost)) return false;
  if (value.outcome !== undefined && !isPrincipleOutcome(value.outcome)) return false;
  return true;
}

function isPrincipleScope(value: unknown): value is PrincipleScope {
  return typeof value === 'string' && (PRINCIPLE_SCOPES as readonly string[]).includes(value);
}

function isPrincipleStatus(value: unknown): value is PrincipleStatus {
  return typeof value === 'string' && (PRINCIPLE_STATUSES as readonly string[]).includes(value);
}

function isConditionOperator(value: unknown): value is ConditionOperator {
  return typeof value === 'string' && (CONDITION_OPERATORS as readonly string[]).includes(value);
}

function isPrincipleConditionField(value: unknown): value is PrincipleConditionField {
  return (
    value === 'mode' ||
    value === 'contradictionCount' ||
    value === 'evidenceCount' ||
    value === 'requestedDomainCount' ||
    value === 'turnIndex' ||
    value === 'requestedDomains' ||
    value === 'requestedActions'
  );
}

function isPrincipleEffectType(value: unknown): value is PrincipleEffectType {
  return typeof value === 'string' && (PRINCIPLE_EFFECT_TYPES as readonly string[]).includes(value);
}

function isValidConditionValue(value: unknown): value is string | number | string[] {
  return typeof value === 'string' || typeof value === 'number' || isStringArray(value);
}

function isOperationModeLike(value: unknown): value is OperationMode {
  return (
    value === 'initial' ||
    value === 'clarify' ||
    value === 'compare' ||
    value === 'extend' ||
    value === 'drill_down'
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
