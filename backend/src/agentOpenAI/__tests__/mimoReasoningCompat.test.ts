// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { describe, expect, it } from '@jest/globals';
import {
  normalizeMimoChatCompletionPayload,
  normalizeMimoChatRequestPayload,
  normalizeMimoSseText,
  shouldUseMimoReasoningContentCompat,
} from '../mimoReasoningCompat';

describe('MiMo reasoning_content compatibility', () => {
  it('enables only for MiMo chat-completions providers', () => {
    expect(shouldUseMimoReasoningContentCompat({
      protocol: 'chat_completions',
      baseURL: 'https://token-plan-sgp.xiaomimimo.com/v1',
      model: 'mimo-v2.5-pro',
      lightModel: 'mimo-v2.5-pro',
    })).toBe(true);

    expect(shouldUseMimoReasoningContentCompat({
      protocol: 'chat_completions',
      baseURL: 'https://compatible.example/v1',
      model: 'mimo-v2.5',
      lightModel: 'mimo-v2.5',
    })).toBe(true);

    expect(shouldUseMimoReasoningContentCompat({
      protocol: 'responses',
      baseURL: 'https://token-plan-sgp.xiaomimimo.com/v1',
      model: 'mimo-v2.5-pro',
      lightModel: 'mimo-v2.5-pro',
    })).toBe(false);

    expect(shouldUseMimoReasoningContentCompat({
      protocol: 'chat_completions',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-5.5',
      lightModel: 'gpt-5.4-mini',
    })).toBe(false);
  });

  it('converts SDK reasoning history back to MiMo reasoning_content', () => {
    const payload: any = {
      model: 'mimo-v2.5-pro',
      messages: [
        {
          role: 'assistant',
          content: null,
          reasoning: 'Need SQL evidence before answering.',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'execute_sql', arguments: '{}' } }],
        },
      ],
    };

    expect(normalizeMimoChatRequestPayload(payload)).toBe(true);
    expect(payload.messages[0]).toMatchObject({
      role: 'assistant',
      reasoning_content: 'Need SQL evidence before answering.',
    });
    expect(payload.messages[0]).not.toHaveProperty('reasoning');
  });

  it('maps MiMo reasoning_content responses into SDK reasoning', () => {
    const payload: any = {
      choices: [
        {
          delta: {
            reasoning_content: 'I should inspect the thread slices.',
            tool_calls: [],
          },
        },
      ],
    };

    expect(normalizeMimoChatCompletionPayload(payload)).toBe(true);
    expect(payload.choices[0].delta.reasoning).toBe('I should inspect the thread slices.');
  });

  it('normalizes streaming SSE data lines', () => {
    const input = [
      'data: {"choices":[{"delta":{"reasoning_content":"think","tool_calls":[]}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const normalized = normalizeMimoSseText(input);

    expect(normalized).toContain('"reasoning_content":"think"');
    expect(normalized).toContain('"reasoning":"think"');
    expect(normalized).toContain('data: [DONE]');
  });
});
