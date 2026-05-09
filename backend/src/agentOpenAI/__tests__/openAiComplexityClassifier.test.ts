// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  buildChatCompletionsUrl,
  classifyQueryWithOpenAILightModel,
} from '../openAiComplexityClassifier';

type FetchArgs = { input: URL | string; init?: RequestInit };

function installFetchMock(impl: (args: FetchArgs) => Promise<Response>): jest.Mock {
  const mock = jest.fn(async (input: URL | string, init?: RequestInit) => impl({ input, init }));
  (globalThis as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return mock as unknown as jest.Mock;
}

const baseConfig = {
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-test-key',
  lightModel: 'gpt-5.4-mini',
  classifierTimeoutMs: 5_000,
};

describe('buildChatCompletionsUrl', () => {
  it('appends /chat/completions to a baseURL without trailing slash', () => {
    expect(buildChatCompletionsUrl('https://api.openai.com/v1').toString())
      .toBe('https://api.openai.com/v1/chat/completions');
  });

  it('handles trailing slash without producing a double slash', () => {
    expect(buildChatCompletionsUrl('https://api.openai.com/v1/').toString())
      .toBe('https://api.openai.com/v1/chat/completions');
  });

  it('preserves Azure-style custom path prefixes', () => {
    expect(buildChatCompletionsUrl('https://x.openai.azure.com/openai/deployments/gpt/').toString())
      .toBe('https://x.openai.azure.com/openai/deployments/gpt/chat/completions');
  });
});

describe('classifyQueryWithOpenAILightModel', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    jest.useRealTimers();
  });

  it('parses a normal JSON response into quick complexity', async () => {
    installFetchMock(async () => new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"complexity":"quick","reason":"simple lookup"}' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    const result = await classifyQueryWithOpenAILightModel('trace 时长?', baseConfig);
    expect(result.complexity).toBe('quick');
    expect(result.reason).toBe('simple lookup');
  });

  it('falls back to full when the response has no parseable JSON', async () => {
    installFetchMock(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: 'no json here at all' } }] }),
      { status: 200 },
    ));

    const result = await classifyQueryWithOpenAILightModel('q', baseConfig);
    expect(result.complexity).toBe('full');
    expect(result.reason).toContain('no JSON');
  });

  it('falls back to full on HTTP non-200', async () => {
    installFetchMock(async () => new Response('forbidden', { status: 403 }));

    const result = await classifyQueryWithOpenAILightModel('q', baseConfig);
    expect(result.complexity).toBe('full');
    expect(result.reason).toContain('HTTP 403');
  });

  it('falls back to full when fetch is aborted by the configured timeout', async () => {
    installFetchMock(async ({ init }) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));

    const result = await classifyQueryWithOpenAILightModel('q', { ...baseConfig, classifierTimeoutMs: 5 });
    expect(result.complexity).toBe('full');
    expect(result.reason).toContain('timed out');
  });

  it('falls back to full when baseURL is missing without making any HTTP call', async () => {
    const fetchMock = installFetchMock(async () => new Response('{}', { status: 200 }));

    const result = await classifyQueryWithOpenAILightModel('q', { ...baseConfig, baseURL: '' });
    expect(result.complexity).toBe('full');
    expect(result.reason).toBe('OpenAI baseURL missing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends model + Authorization + chat-completions URL correctly', async () => {
    let capturedUrl: string | undefined;
    let capturedAuth: string | undefined;
    let capturedBody: { model?: string; messages?: unknown[] } | undefined;

    installFetchMock(async ({ input, init }) => {
      capturedUrl = (input as URL).toString();
      const headers = init?.headers as Record<string, string> | undefined;
      capturedAuth = headers?.Authorization;
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"complexity":"full","reason":"x"}' } }] }),
        { status: 200 },
      );
    });

    await classifyQueryWithOpenAILightModel('hello', baseConfig);
    expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect(capturedAuth).toBe('Bearer sk-test-key');
    expect(capturedBody?.model).toBe('gpt-5.4-mini');
    expect(Array.isArray(capturedBody?.messages)).toBe(true);
  });

  it('omits Authorization header when no apiKey is configured', async () => {
    let capturedAuth: string | undefined;
    installFetchMock(async ({ init }) => {
      capturedAuth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"complexity":"quick","reason":"x"}' } }] }),
        { status: 200 },
      );
    });

    await classifyQueryWithOpenAILightModel('q', { ...baseConfig, apiKey: undefined });
    expect(capturedAuth).toBeUndefined();
  });
});
