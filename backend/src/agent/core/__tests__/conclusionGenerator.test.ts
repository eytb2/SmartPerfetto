/**
 * ConclusionGenerator Unit Tests
 */

import { generateConclusion } from '../conclusionGenerator';
import type { Finding, Intent } from '../../types';
import type { ProgressEmitter } from '../orchestratorTypes';
import type { ModelRouter } from '../modelRouter';

describe('conclusionGenerator', () => {
  let mockModelRouter: jest.Mocked<Partial<ModelRouter>>;
  let emitter: ProgressEmitter;
  let emittedUpdates: Array<{ type: string; content: any }>;
  let logs: string[];

  const sharedContext = {
    sessionId: 'session-1',
    traceId: 'trace-1',
    hypotheses: new Map<string, any>(),
    confirmedFindings: [],
    investigationPath: [],
  };

  const intent: Intent = {
    primaryGoal: '分析滑动卡顿的根因',
    aspects: ['jank'],
    expectedOutputType: 'diagnosis',
    complexity: 'moderate',
    followUpType: 'initial',
  };

  const findings: Finding[] = [
    {
      id: 'f-1',
      severity: 'critical',
      title: '主线程阻塞导致掉帧',
      description: '在多个关键帧中观察到主线程长时间 Runnable/Running',
      details: { frame_id: 123, dur_ms: 45.2 },
      source: 'test',
      confidence: 0.9,
    },
  ];

  beforeEach(() => {
    emittedUpdates = [];
    logs = [];

    mockModelRouter = {
      callWithFallback: jest.fn().mockResolvedValue({
        success: true,
        response: '测试结论',
        modelId: 'test-model',
        usage: { inputTokens: 100, outputTokens: 50, totalCost: 0.001 },
        latencyMs: 500,
      }),
    };

    emitter = {
      emitUpdate: (type, content) => {
        emittedUpdates.push({ type, content });
      },
      log: (message) => {
        logs.push(message);
      },
    };
  });

  test('uses standard root-cause prompt for early turns', async () => {
    const conclusion = await generateConclusion(
      sharedContext as any,
      findings,
      intent,
      mockModelRouter as unknown as ModelRouter,
      emitter,
      undefined,
      { turnCount: 0 }
    );

    expect(conclusion).toBe('测试结论');
    expect(mockModelRouter.callWithFallback).toHaveBeenCalledWith(
      expect.stringContaining('根因分析'),
      'synthesis',
      expect.objectContaining({
        promptId: 'agent.conclusionGenerator',
        promptVersion: '1.0.0',
        contractVersion: 'conclusion_text@1.0.0',
      })
    );
  });

  test('switches to dialogue mode prompt when turnCount >= 1', async () => {
    const conclusion = await generateConclusion(
      sharedContext as any,
      findings,
      { ...intent, followUpType: 'extend' },
      mockModelRouter as unknown as ModelRouter,
      emitter,
      '连续多轮没有新增证据',
      { turnCount: 1, historyContext: 'HISTORY_CONTEXT' }
    );

    expect(conclusion).toBe('测试结论');
    expect(mockModelRouter.callWithFallback).toHaveBeenCalledWith(
      expect.stringContaining('HISTORY_CONTEXT'),
      'synthesis',
      expect.objectContaining({
        promptId: 'agent.conclusionGenerator.dialogue',
        promptVersion: '1.0.0',
        contractVersion: 'conclusion_dialogue_text@1.0.0',
      })
    );

    // Ensure prompt includes the core dialogue instructions
    const calledPrompt = (mockModelRouter.callWithFallback as jest.Mock).mock.calls[0][0] as string;
    expect(calledPrompt).toContain('多轮对话');
    expect(calledPrompt).toContain('输出尽量短');
    expect(calledPrompt).toContain('Q:');
  });

  test('dialogue mode falls back to question-driven text when LLM fails', async () => {
    mockModelRouter.callWithFallback = jest.fn().mockRejectedValue(new Error('LLM down'));

    const conclusion = await generateConclusion(
      sharedContext as any,
      [],
      { ...intent, followUpType: 'extend' },
      mockModelRouter as unknown as ModelRouter,
      emitter,
      undefined,
      { turnCount: 3, historyContext: 'HISTORY' }
    );

    expect(conclusion).toContain('Q:');
    expect(conclusion).toContain('A.');
    expect(emittedUpdates.some(u => u.type === 'degraded')).toBe(true);
  });

  test('non-dialogue mode falls back to simple markdown summary when LLM fails', async () => {
    mockModelRouter.callWithFallback = jest.fn().mockRejectedValue(new Error('LLM down'));

    const conclusion = await generateConclusion(
      sharedContext as any,
      findings,
      intent,
      mockModelRouter as unknown as ModelRouter,
      emitter,
      undefined,
      { turnCount: 0 }
    );

    expect(conclusion).toContain('## 分析结论');
    expect(conclusion).toContain('严重问题');
  });
});
