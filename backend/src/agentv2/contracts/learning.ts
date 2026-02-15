import type { PrincipleDefinition } from './policy';

export const LESSON_CATEGORIES = [
  'contradiction',
  'missed_root_cause',
  'overconfident_conclusion',
  'inefficient_plan',
  'user_intervention',
] as const;

export type LessonCategory = (typeof LESSON_CATEGORIES)[number];

export const LESSON_SEVERITIES = [
  'low',
  'medium',
  'high',
  'critical',
] as const;

export type LessonSeverity = (typeof LESSON_SEVERITIES)[number];

export const PRINCIPLE_UPDATE_ACTIONS = [
  'add',
  'strengthen',
  'weaken',
  'remove',
] as const;

export type PrincipleUpdateAction = (typeof PRINCIPLE_UPDATE_ACTIONS)[number];

export interface LearningSignal {
  id: string;
  source: 'finding' | 'evidence' | 'intervention' | 'evaluation';
  summary: string;
  evidenceIds: string[];
  createdAt: number;
}

export interface Lesson {
  id: string;
  traceId: string;
  sessionId: string;
  category: LessonCategory;
  severity: LessonSeverity;
  summary: string;
  rootCauseHypothesis: string;
  signals: LearningSignal[];
  createdAt: number;
}

export interface PrincipleCandidateUpdate {
  id: string;
  action: PrincipleUpdateAction;
  targetPrincipleId?: string;
  draftPrinciple?: PrincipleDefinition;
  rationale: string;
  lessonIds: string[];
  createdAt: number;
}

export interface LearningEvaluation {
  id: string;
  traceId: string;
  sessionId: string;
  contradictionRate: number;
  convergenceRounds: number;
  evidenceCoverage: number;
  actionableScore: number;
  createdAt: number;
}

export function isLesson(value: unknown): value is Lesson {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.traceId)) return false;
  if (!isNonEmptyString(value.sessionId)) return false;
  if (!isLessonCategory(value.category)) return false;
  if (!isLessonSeverity(value.severity)) return false;
  if (!isNonEmptyString(value.summary)) return false;
  if (!isNonEmptyString(value.rootCauseHypothesis)) return false;
  if (!Array.isArray(value.signals) || !value.signals.every(isLearningSignal)) return false;
  if (!isFiniteNumber(value.createdAt)) return false;
  return true;
}

export function isPrincipleCandidateUpdate(value: unknown): value is PrincipleCandidateUpdate {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isPrincipleUpdateAction(value.action)) return false;
  if (value.targetPrincipleId !== undefined && !isNonEmptyString(value.targetPrincipleId)) return false;
  if (value.draftPrinciple !== undefined && !isRecord(value.draftPrinciple)) return false;
  if (!isNonEmptyString(value.rationale)) return false;
  if (!isStringArray(value.lessonIds)) return false;
  if (!isFiniteNumber(value.createdAt)) return false;
  return true;
}

export function isLearningEvaluation(value: unknown): value is LearningEvaluation {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.traceId)) return false;
  if (!isNonEmptyString(value.sessionId)) return false;
  if (!isFiniteNumber(value.contradictionRate)) return false;
  if (!isFiniteNumber(value.convergenceRounds)) return false;
  if (!isFiniteNumber(value.evidenceCoverage)) return false;
  if (!isFiniteNumber(value.actionableScore)) return false;
  if (!isFiniteNumber(value.createdAt)) return false;
  return true;
}

function isLearningSignal(value: unknown): value is LearningSignal {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isLearningSignalSource(value.source)) return false;
  if (!isNonEmptyString(value.summary)) return false;
  if (!isStringArray(value.evidenceIds)) return false;
  if (!isFiniteNumber(value.createdAt)) return false;
  return true;
}

function isLessonCategory(value: unknown): value is LessonCategory {
  return typeof value === 'string' && (LESSON_CATEGORIES as readonly string[]).includes(value);
}

function isLessonSeverity(value: unknown): value is LessonSeverity {
  return typeof value === 'string' && (LESSON_SEVERITIES as readonly string[]).includes(value);
}

function isPrincipleUpdateAction(value: unknown): value is PrincipleUpdateAction {
  return typeof value === 'string' && (PRINCIPLE_UPDATE_ACTIONS as readonly string[]).includes(value);
}

function isLearningSignalSource(value: unknown): value is LearningSignal['source'] {
  return (
    value === 'finding' ||
    value === 'evidence' ||
    value === 'intervention' ||
    value === 'evaluation'
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
