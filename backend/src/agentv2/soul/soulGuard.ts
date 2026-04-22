// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type { DecisionContext, SoulProfile, SoulViolation } from '../contracts/policy';
import type { OperationPlan, OperationStepKind } from '../contracts/runtime';

const EVIDENCE_STEP_KINDS: ReadonlySet<OperationStepKind> = new Set([
  'collect_evidence',
  'test_hypothesis',
  'resolve_contradiction',
  'compare_entities',
]);

export interface SoulGuardInput {
  context: DecisionContext;
  plan: OperationPlan;
  claimedConfidence?: number;
}

export interface SoulGuardResult {
  passed: boolean;
  violations: SoulViolation[];
}

export function evaluateSoulGuard(profile: SoulProfile, input: SoulGuardInput): SoulGuardResult {
  const violations: SoulViolation[] = [];

  violations.push(...validateDomainBoundaries(profile, input.plan));
  violations.push(...validateEvidenceBeforeConclusion(input.plan));
  violations.push(...validateTraceableConclusion(input.plan));
  violations.push(...validateConfidenceHonesty(input.context.evidenceCount, input.claimedConfidence));

  return {
    passed: violations.length === 0,
    violations,
  };
}

function validateDomainBoundaries(profile: SoulProfile, plan: OperationPlan): SoulViolation[] {
  const allowed = new Set(profile.domainBoundaries);
  const usedDomains = new Set<string>();

  for (const target of plan.targets) {
    usedDomains.add(target.domain);
  }
  for (const step of plan.steps) {
    for (const domain of step.domains) {
      usedDomains.add(domain);
    }
  }

  const unknownDomains = Array.from(usedDomains).filter(domain => !allowed.has(domain));
  if (unknownDomains.length === 0) {
    return [];
  }

  return [
    {
      code: 'soul.domain_boundary_violation',
      constraintId: 'android-domain-boundary',
      message: `Plan uses unsupported domain(s): ${unknownDomains.join(', ')}`,
      severity: 'error',
    },
  ];
}

function validateEvidenceBeforeConclusion(plan: OperationPlan): SoulViolation[] {
  const violations: SoulViolation[] = [];

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    if (step.kind !== 'conclude') continue;

    const hasPriorEvidenceStep = plan.steps
      .slice(0, i)
      .some(previous => EVIDENCE_STEP_KINDS.has(previous.kind));

    if (!hasPriorEvidenceStep) {
      violations.push({
        code: 'soul.evidence_before_conclusion',
        constraintId: 'evidence-before-conclusion',
        message: `Conclusion step "${step.id}" appears before any evidence collection step.`,
        severity: 'error',
      });
    }
  }

  return violations;
}

function validateTraceableConclusion(plan: OperationPlan): SoulViolation[] {
  const violations: SoulViolation[] = [];

  for (const step of plan.steps) {
    if (step.kind !== 'conclude') continue;

    if (step.requiredEvidence.length === 0) {
      violations.push({
        code: 'soul.conclusion_without_evidence_links',
        constraintId: 'traceable-conclusion',
        message: `Conclusion step "${step.id}" has no required evidence references.`,
        severity: 'error',
      });
    }
  }

  return violations;
}

function validateConfidenceHonesty(
  evidenceCount: number,
  claimedConfidence: number | undefined
): SoulViolation[] {
  if (claimedConfidence === undefined) {
    return [];
  }

  if (claimedConfidence < 0.85) {
    return [];
  }

  if (evidenceCount >= 2) {
    return [];
  }

  return [
    {
      code: 'soul.overconfident_without_evidence',
      constraintId: 'confidence-honesty',
      message: `Claimed confidence ${claimedConfidence.toFixed(2)} is too high for evidence count ${evidenceCount}.`,
      severity: 'error',
    },
  ];
}
