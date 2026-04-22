// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

export const OPERATION_MODES = [
  'initial',
  'clarify',
  'compare',
  'extend',
  'drill_down',
] as const;

export type OperationMode = (typeof OPERATION_MODES)[number];

export const OPERATION_STEP_KINDS = [
  'collect_evidence',
  'test_hypothesis',
  'resolve_contradiction',
  'compare_entities',
  'explain_findings',
  'conclude',
] as const;

export type OperationStepKind = (typeof OPERATION_STEP_KINDS)[number];

export interface DomainTarget {
  domain: string;
  reason?: string;
}

export type EntityType =
  | 'frame'
  | 'session'
  | 'startup'
  | 'process'
  | 'binder_call'
  | 'time_range';

export interface EntityReference {
  type: EntityType;
  id?: string | number;
  value?: unknown;
}

export interface OperationStep {
  id: string;
  kind: OperationStepKind;
  objective: string;
  domains: string[];
  requiredEvidence: string[];
  dependsOn: string[];
}

export interface StopCriteria {
  maxSteps: number;
  maxRounds: number;
  minConfidenceToConclude: number;
  stopOnCriticalContradiction: boolean;
}

export interface OperationPlan {
  id: string;
  mode: OperationMode;
  objective: string;
  targets: DomainTarget[];
  steps: OperationStep[];
  stopCriteria: StopCriteria;
}

export function isOperationMode(value: unknown): value is OperationMode {
  return typeof value === 'string' && (OPERATION_MODES as readonly string[]).includes(value);
}

export function isOperationStepKind(value: unknown): value is OperationStepKind {
  return typeof value === 'string' && (OPERATION_STEP_KINDS as readonly string[]).includes(value);
}

export function createDefaultStopCriteria(mode: OperationMode): StopCriteria {
  const byMode: Record<OperationMode, StopCriteria> = {
    initial: {
      maxSteps: 6,
      maxRounds: 3,
      minConfidenceToConclude: 0.75,
      stopOnCriticalContradiction: true,
    },
    clarify: {
      maxSteps: 3,
      maxRounds: 2,
      minConfidenceToConclude: 0.7,
      stopOnCriticalContradiction: true,
    },
    compare: {
      maxSteps: 6,
      maxRounds: 3,
      minConfidenceToConclude: 0.72,
      stopOnCriticalContradiction: true,
    },
    extend: {
      maxSteps: 5,
      maxRounds: 3,
      minConfidenceToConclude: 0.73,
      stopOnCriticalContradiction: true,
    },
    drill_down: {
      maxSteps: 4,
      maxRounds: 2,
      minConfidenceToConclude: 0.8,
      stopOnCriticalContradiction: true,
    },
  };

  return byMode[mode];
}

export function isOperationPlan(value: unknown): value is OperationPlan {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isOperationMode(value.mode)) return false;
  if (!isNonEmptyString(value.objective)) return false;
  if (!Array.isArray(value.targets) || !value.targets.every(isDomainTarget)) return false;
  if (!Array.isArray(value.steps) || !value.steps.every(isOperationStep)) return false;
  if (!isStopCriteria(value.stopCriteria)) return false;
  return true;
}

export function assertOperationPlan(value: unknown): OperationPlan {
  if (!isOperationPlan(value)) {
    throw new Error('Invalid OperationPlan payload');
  }
  return value;
}

function isOperationStep(value: unknown): value is OperationStep {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isOperationStepKind(value.kind)) return false;
  if (!isNonEmptyString(value.objective)) return false;
  if (!isStringArray(value.domains)) return false;
  if (!isStringArray(value.requiredEvidence)) return false;
  if (!isStringArray(value.dependsOn)) return false;
  return true;
}

function isStopCriteria(value: unknown): value is StopCriteria {
  if (!isRecord(value)) return false;
  if (!isFiniteNumber(value.maxSteps)) return false;
  if (!isFiniteNumber(value.maxRounds)) return false;
  if (!isFiniteNumber(value.minConfidenceToConclude)) return false;
  if (typeof value.stopOnCriticalContradiction !== 'boolean') return false;
  return true;
}

function isDomainTarget(value: unknown): value is DomainTarget {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.domain)) return false;
  if (value.reason !== undefined && typeof value.reason !== 'string') return false;
  return true;
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
