// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * OpenAI-side query complexity AI fallback.
 *
 * Mirrors the Haiku-based classifier in agentv3/queryComplexityClassifier.ts but uses
 * OpenAI's light model via /chat/completions. Kept in agentOpenAI/ so OpenAI-only users
 * don't drag in the Anthropic SDK at module-load time.
 *
 * Contract is provider-symmetric:
 *   render `prompt-complexity-classifier` template → single-turn LLM call → JSON parse →
 *   graceful fallback to 'full' on any failure.
 */

import { loadPromptTemplate, renderTemplate } from '../agentv3/strategyLoader';
import type { QueryComplexity } from '../agentv3/types';
import type { OpenAIAgentConfig } from './openAiConfig';

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function buildClassifierPrompt(query: string): string {
  const template = loadPromptTemplate('prompt-complexity-classifier');
  return template
    ? renderTemplate(template, { query })
    : `Classify this Android trace analysis query as "quick" (factual) or "full" (analysis).\nQuery: ${query}\nOutput JSON: {"complexity": "quick" or "full", "reason": "..."}`;
}

function parseClassifierJson(text: string): { complexity: QueryComplexity; reason: string } {
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    return { complexity: 'full', reason: 'no JSON in OpenAI response' };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { complexity?: unknown; reason?: unknown };
    const complexity: QueryComplexity = parsed.complexity === 'quick' ? 'quick' : 'full';
    const reason = typeof parsed.reason === 'string' && parsed.reason.length > 0
      ? parsed.reason
      : 'AI classification';
    return { complexity, reason };
  } catch {
    return { complexity: 'full', reason: 'failed to parse OpenAI JSON response' };
  }
}

/**
 * Build the chat-completions URL from the configured baseURL. Handles trailing
 * slash + custom path prefixes (e.g., Azure OpenAI deployments) by normalizing
 * the base to end with '/' before appending the relative endpoint.
 */
export function buildChatCompletionsUrl(baseUrl: string): URL {
  const normalized = baseUrl.replace(/\/?$/, '/');
  return new URL('chat/completions', normalized);
}

/**
 * Single-turn classification via OpenAI-compatible chat completions.
 * Uses config.lightModel (default `gpt-5.4-mini`). Compatible with OpenAI,
 * DeepSeek, Qwen, and most local LLM gateways that expose /chat/completions.
 */
export async function classifyQueryWithOpenAILightModel(
  query: string,
  config: Pick<OpenAIAgentConfig, 'baseURL' | 'apiKey' | 'lightModel' | 'classifierTimeoutMs'>,
): Promise<{ complexity: QueryComplexity; reason: string }> {
  if (!config.baseURL) {
    return { complexity: 'full', reason: 'OpenAI baseURL missing' };
  }

  const prompt = buildClassifierPrompt(query);
  const url = buildChatCompletionsUrl(config.baseURL);
  const controller = new AbortController();
  const timeoutMs = config.classifierTimeoutMs ?? 30_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.lightModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 200,
      }),
    });

    if (!res.ok) {
      return { complexity: 'full', reason: `OpenAI classifier HTTP ${res.status}` };
    }

    const data = (await res.json()) as ChatCompletionsResponse;
    const text = data.choices?.[0]?.message?.content ?? '';
    return parseClassifierJson(text);
  } catch (err) {
    if (timedOut) {
      return { complexity: 'full', reason: `OpenAI classifier timed out after ${timeoutMs / 1000}s` };
    }
    return { complexity: 'full', reason: `OpenAI classifier failed: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}
