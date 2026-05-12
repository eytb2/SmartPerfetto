// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { describe, expect, it, jest } from '@jest/globals';
import { OpenAIRuntime, __testing } from '../openAiRuntime';
import type { AnalysisPlanV3, PlanPhase } from '../../agentv3/types';

function phase(id: string, status: PlanPhase['status']): PlanPhase {
  const p: PlanPhase = {
    id,
    name: `Phase ${id}`,
    goal: `Goal ${id}`,
    expectedTools: ['invoke_skill'],
    status,
  };
  if (status === 'completed' || status === 'skipped') {
    p.summary = `Evidence summary for ${id}`;
  }
  return p;
}

function plan(phases: PlanPhase[]): AnalysisPlanV3 {
  return {
    phases,
    successCriteria: 'Complete every phase before final answer',
    submittedAt: Date.now(),
    toolCallLog: [],
  };
}

describe('OpenAIRuntime plan completion guard', () => {
  it('treats full-mode runs as incomplete until every plan phase is closed', () => {
    const runtime = new OpenAIRuntime({} as any) as any;

    expect(runtime.getPlanCompletionStatus('s1', false)).toMatchObject({
      complete: false,
      hasPlan: false,
      pendingPhases: [],
    });

    runtime.sessionPlans.set('s1', {
      current: plan([phase('p1', 'completed'), phase('p2', 'pending'), phase('p3', 'in_progress')]),
      history: [],
    });

    expect(runtime.getPlanCompletionStatus('s1', false)).toMatchObject({
      complete: false,
      hasPlan: true,
      pendingPhases: [
        expect.objectContaining({ id: 'p2' }),
        expect.objectContaining({ id: 'p3' }),
      ],
    });

    runtime.sessionPlans.set('s1', {
      current: plan([phase('p1', 'completed'), phase('p2', 'skipped')]),
      history: [],
    });

    expect(runtime.getPlanCompletionStatus('s1', false)).toMatchObject({
      complete: true,
      hasPlan: true,
      pendingPhases: [],
    });
  });

  it('does not require a plan in quick mode', () => {
    const runtime = new OpenAIRuntime({} as any) as any;

    expect(runtime.getPlanCompletionStatus('s1', true)).toMatchObject({
      complete: true,
      hasPlan: false,
      pendingPhases: [],
    });
  });

  it('does not treat closed phases with weak summaries as complete', () => {
    const runtime = new OpenAIRuntime({} as any) as any;
    const weak = phase('p1', 'completed');
    weak.summary = 'done';

    runtime.sessionPlans.set('s1', {
      current: plan([weak]),
      history: [],
    });

    expect(runtime.getPlanCompletionStatus('s1', false)).toMatchObject({
      complete: false,
      hasPlan: true,
      pendingPhases: [expect.objectContaining({ id: 'p1' })],
    });
  });

  it('only allows deterministic stream finalization after full-mode plan completion with an answer', () => {
    const runtime = new OpenAIRuntime({} as any) as any;

    runtime.sessionPlans.set('s1', {
      current: plan([phase('p1', 'completed'), phase('p2', 'in_progress')]),
      history: [],
    });
    expect(runtime.shouldFinalizeAfterPlanComplete('s1', false, 'final text')).toBe(false);

    runtime.sessionPlans.set('s1', {
      current: plan([phase('p1', 'completed'), phase('p2', 'skipped')]),
      history: [],
    });
    expect(runtime.shouldFinalizeAfterPlanComplete('s1', false, '')).toBe(false);
    expect(runtime.shouldFinalizeAfterPlanComplete('s1', false, 'final text')).toBe(true);
    expect(runtime.shouldFinalizeAfterPlanComplete('s1', true, 'final text')).toBe(false);
  });
});

describe('OpenAIRuntime previous response recovery', () => {
  it('recognizes stale previous response errors from OpenAI Responses', () => {
    expect(__testing.isMissingOpenAIPreviousResponseError(
      new Error('No response found with id resp_old_123'),
      'resp_old_123',
    )).toBe(true);
    expect(__testing.isMissingOpenAIPreviousResponseError(
      new Error('previous_response_id does not exist'),
      'resp_old_123',
    )).toBe(true);
    expect(__testing.isMissingOpenAIPreviousResponseError(
      new Error('rate limit exceeded'),
      'resp_old_123',
    )).toBe(false);
  });

  it('does not expose stale OpenAI response mappings for persistence', () => {
    const now = 1_700_000_000_000;
    const runtime = new OpenAIRuntime({} as any) as any;
    runtime.sessionMap.set('s1', {
      lastResponseId: 'resp_stale',
      updatedAt: now - (5 * 60 * 60 * 1000),
    });

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      expect(runtime.getSdkSessionId('s1')).toBeUndefined();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('clears stale previous response ids while preserving local history', () => {
    const runtime = new OpenAIRuntime({} as any) as any;
    const history = [{ role: 'user', content: 'previous question' }];
    runtime.sessionMap.set('s1', {
      history,
      lastResponseId: 'resp_stale',
      runState: '{"state":true}',
      updatedAt: Date.now(),
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      runtime.forgetOpenAILastResponseId('s1', 'No response found with id resp_stale');
    } finally {
      warnSpy.mockRestore();
    }

    expect(runtime.sessionMap.get('s1')).toEqual(expect.objectContaining({
      history,
      lastResponseId: undefined,
      runState: undefined,
    }));
  });

  it('does not persist stale OpenAI response mappings into snapshots', () => {
    const now = 1_700_000_000_000;
    const runtime = new OpenAIRuntime({} as any) as any;
    runtime.sessionMap.set('s1', {
      history: [{ role: 'user', content: 'previous question' }],
      lastResponseId: 'resp_stale',
      updatedAt: now - (5 * 60 * 60 * 1000),
    });

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const snapshot = runtime.takeSnapshot('s1', 'trace-1', {
        conversationSteps: [],
        queryHistory: [],
        conclusionHistory: [],
        agentDialogue: [],
        agentResponses: [],
        dataEnvelopes: [],
        hypotheses: [],
        runSequence: 0,
        conversationOrdinal: 0,
      });

      expect(snapshot.sdkSessionId).toBeUndefined();
      expect(snapshot.openAILastResponseId).toBeUndefined();
      expect(snapshot.openAIHistory).toBeUndefined();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('persists fresh OpenAI response mappings into snapshots', () => {
    const now = 1_700_000_000_000;
    const runtime = new OpenAIRuntime({} as any) as any;
    const history = [{ role: 'user', content: 'previous question' }];
    runtime.sessionMap.set('s1', {
      history,
      lastResponseId: 'resp_fresh',
      runState: '{"state":true}',
      updatedAt: now - (30 * 60 * 1000),
    });

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const snapshot = runtime.takeSnapshot('s1', 'trace-1', {
        conversationSteps: [],
        queryHistory: [],
        conclusionHistory: [],
        agentDialogue: [],
        agentResponses: [],
        dataEnvelopes: [],
        hypotheses: [],
        runSequence: 0,
        conversationOrdinal: 0,
      });

      expect(snapshot.sdkSessionId).toBe('resp_fresh');
      expect(snapshot.openAILastResponseId).toBe('resp_fresh');
      expect(snapshot.openAIHistory).toBe(history);
      expect(snapshot.openAIRunState).toBe('{"state":true}');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('restores OpenAI response mappings with the snapshot timestamp', () => {
    const runtime = new OpenAIRuntime({} as any) as any;
    const snapshotTimestamp = Date.now() - (5 * 60 * 60 * 1000);

    runtime.restoreFromSnapshot('s1', 'trace-1', {
      version: 1,
      snapshotTimestamp,
      sessionId: 's1',
      traceId: 'trace-1',
      conversationSteps: [],
      queryHistory: [],
      conclusionHistory: [],
      agentDialogue: [],
      agentResponses: [],
      dataEnvelopes: [],
      hypotheses: [],
      analysisNotes: [],
      analysisPlan: null,
      planHistory: [],
      uncertaintyFlags: [],
      openAIHistory: [{ role: 'user', content: 'previous question' }],
      openAILastResponseId: 'resp_old',
      runSequence: 0,
      conversationOrdinal: 0,
    });

    expect(runtime.sessionMap.get('s1')).toEqual(expect.objectContaining({
      lastResponseId: 'resp_old',
      updatedAt: snapshotTimestamp,
    }));
  });
});
