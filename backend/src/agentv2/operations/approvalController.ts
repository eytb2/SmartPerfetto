// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { InterventionController } from '../../agent/core/interventionController';
import type { DecisionContext, PrincipleDecision } from '../contracts/policy';

export interface ApprovalResult {
  required: boolean;
  interventionId?: string;
}

export class ApprovalController {
  private readonly interventionController: InterventionController;

  constructor(interventionController?: InterventionController) {
    this.interventionController = interventionController || new InterventionController();
  }

  evaluate(decision: PrincipleDecision, context: DecisionContext): ApprovalResult {
    if (decision.outcome !== 'require_approval') {
      return { required: false };
    }

    const pending = this.interventionController.createAgentIntervention(
      context.sessionId,
      'Principles require explicit approval before continuing.',
      [
        {
          id: 'approve_principle_flow',
          label: 'Approve',
          description: 'Continue with principle-constrained analysis plan',
          action: 'continue',
          recommended: true,
        },
        {
          id: 'abort_principle_flow',
          label: 'Abort',
          description: 'Abort this analysis turn',
          action: 'abort',
        },
      ],
      {
        currentFindings: [],
        possibleDirections: [],
        elapsedTimeMs: 0,
        confidence: 0.5,
        roundsCompleted: 0,
        progressSummary: context.userGoal,
      }
    );

    return {
      required: true,
      interventionId: pending.id,
    };
  }

  getInterventionController(): InterventionController {
    return this.interventionController;
  }
}
