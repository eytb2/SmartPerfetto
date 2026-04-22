// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type {
  AnalysisResult,
} from '../../../agent/core/orchestratorTypes';
import type { Finding } from '../../../agent/types';
import { ModelRouter } from '../../../agent/core/modelRouter';
import { buildNativeClarifyFallback, buildNativeClarifyPrompt } from '../runtimeContextBuilder';
import type { RuntimeModeHandler, RuntimeModeExecutionRequest, RuntimeMode } from '../runtimeModeContracts';

interface ClarifyModeHandlerDeps {
  modelRouter: ModelRouter;
}

export class ClarifyModeHandler implements RuntimeModeHandler {
  private readonly modelRouter: ModelRouter;

  constructor(deps: ClarifyModeHandlerDeps) {
    this.modelRouter = deps.modelRouter;
  }

  supports(mode: RuntimeMode): boolean {
    return mode === 'clarify';
  }

  async execute(request: RuntimeModeExecutionRequest): Promise<AnalysisResult> {
    const { runtimeContext, query, sessionId, traceId } = request;
    const contextSummary = runtimeContext.sessionContext.generatePromptContext(700);
    const recentFindings = runtimeContext.sessionContext.getAllFindings().slice(-5);

    const prompt = buildNativeClarifyPrompt(query, contextSummary, recentFindings);
    const start = Date.now();

    let explanation = '';
    try {
      const response = await this.modelRouter.callWithFallback(prompt, 'synthesis', {
        sessionId,
        traceId,
        promptId: 'agentv2.nativeClarify',
        promptVersion: '1.0.0',
        contractVersion: 'clarify_text@1.0.0',
      });
      explanation = (response.response || '').trim();
    } catch {
      explanation = '';
    }

    const outputText = explanation || buildNativeClarifyFallback(query, recentFindings);
    const finding: Finding = {
      id: `agentv2_clarify_${Date.now()}`,
      category: 'explanation',
      type: 'clarification',
      severity: 'info',
      title: '解释说明',
      description: outputText,
      source: 'agentv2.runtime',
      confidence: 0.88,
    };

    const turn = runtimeContext.sessionContext.addTurn(
      query,
      runtimeContext.intent,
      {
        success: true,
        findings: [finding],
        confidence: 0.88,
        message: outputText,
      },
      [finding]
    );
    runtimeContext.sessionContext.updateWorkingMemoryFromConclusion({
      turnIndex: turn.turnIndex,
      query,
      conclusion: outputText,
      confidence: 0.88,
    });
    runtimeContext.sessionContext.recordTraceAgentTurn({
      turnId: turn.id,
      turnIndex: turn.turnIndex,
      query,
      followUpType: runtimeContext.intent.followUpType,
      intentPrimaryGoal: runtimeContext.intent.primaryGoal,
      conclusion: outputText,
      confidence: 0.88,
    });

    return {
      sessionId,
      success: true,
      findings: [finding],
      hypotheses: [],
      conclusion: outputText,
      confidence: 0.88,
      rounds: 1,
      totalDurationMs: Date.now() - start,
    };
  }
}
