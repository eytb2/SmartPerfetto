// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { TextDecoder, TextEncoder } from 'util';
import type { OpenAIAgentConfig } from './openAiConfig';

type JsonRecord = Record<string, any>;
type FetchLike = typeof fetch;
type FetchInput = Parameters<FetchLike>[0];
type FetchInit = Parameters<FetchLike>[1];
type FetchResult = Awaited<ReturnType<FetchLike>>;

const CHAT_COMPLETIONS_PATH = /\/chat\/completions(?:[?#]|$)/;
const MIMO_BASE_URL_PATTERN = /xiaomimimo\.com/i;
const MIMO_MODEL_PATTERN = /\bmimo-v/i;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function getRequestUrl(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  const maybeUrl = (input as { url?: unknown })?.url;
  return typeof maybeUrl === 'string' ? maybeUrl : '';
}

function headersWithoutContentLength(headers: unknown): unknown {
  if (!headers) return headers;
  const HeadersCtor = (globalThis as any).Headers;
  if (!HeadersCtor) return headers;
  const copied = new HeadersCtor(headers as any);
  copied.delete('content-length');
  return copied;
}

export function shouldUseMimoReasoningContentCompat(
  config: Pick<OpenAIAgentConfig, 'protocol' | 'baseURL' | 'model' | 'lightModel'>,
): boolean {
  if (config.protocol !== 'chat_completions') return false;
  const baseURL = config.baseURL || '';
  const models = `${config.model || ''} ${config.lightModel || ''}`;
  return MIMO_BASE_URL_PATTERN.test(baseURL) || MIMO_MODEL_PATTERN.test(models);
}

export function normalizeMimoChatRequestPayload(payload: unknown): boolean {
  if (!isRecord(payload) || !Array.isArray(payload.messages)) return false;
  let changed = false;

  for (const message of payload.messages) {
    if (!isRecord(message) || message.role !== 'assistant') continue;
    const reasoning = hasNonEmptyString(message.reasoning)
      ? message.reasoning
      : hasNonEmptyString(message.reasoning_content)
        ? message.reasoning_content
        : undefined;
    if (!reasoning) continue;

    if (message.reasoning_content !== reasoning) {
      message.reasoning_content = reasoning;
      changed = true;
    }
    if ('reasoning' in message) {
      delete message.reasoning;
      changed = true;
    }
  }

  return changed;
}

export function normalizeMimoChatCompletionPayload(payload: unknown): boolean {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return false;
  let changed = false;

  for (const choice of payload.choices) {
    if (!isRecord(choice)) continue;
    for (const key of ['delta', 'message'] as const) {
      const message = choice[key];
      if (!isRecord(message)) continue;
      if (hasNonEmptyString(message.reasoning_content) && message.reasoning !== message.reasoning_content) {
        message.reasoning = message.reasoning_content;
        changed = true;
      }
    }
  }

  return changed;
}

function normalizeRequestBody(body: unknown): { body: unknown; changed: boolean } {
  if (typeof body !== 'string') return { body, changed: false };
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return { body, changed: false };

  try {
    const payload = JSON.parse(body);
    const changed = normalizeMimoChatRequestPayload(payload);
    return changed ? { body: JSON.stringify(payload), changed } : { body, changed: false };
  } catch {
    return { body, changed: false };
  }
}

async function normalizeFetchRequest(
  input: FetchInput,
  init: FetchInit,
): Promise<{ input: FetchInput; init: FetchInit; isChatCompletions: boolean }> {
  const isChatCompletions = CHAT_COMPLETIONS_PATH.test(getRequestUrl(input));
  if (!isChatCompletions) return { input, init, isChatCompletions };

  const normalized = normalizeRequestBody(init?.body);
  if (!normalized.changed) return { input, init, isChatCompletions };

  return {
    input,
    init: {
      ...init,
      body: normalized.body as any,
      headers: headersWithoutContentLength(init?.headers) as any,
    },
    isChatCompletions,
  };
}

function transformSseLine(line: string): string {
  if (!line.startsWith('data:')) return line;
  const prefixMatch = line.match(/^data:\s*/);
  const prefix = prefixMatch?.[0] ?? 'data: ';
  const data = line.slice(prefix.length);
  if (!data || data.trim() === '[DONE]') return line;

  try {
    const payload = JSON.parse(data);
    return normalizeMimoChatCompletionPayload(payload)
      ? `${prefix}${JSON.stringify(payload)}`
      : line;
  } catch {
    return line;
  }
}

export function normalizeMimoSseText(text: string): string {
  return text
    .split('\n')
    .map((line) => transformSseLine(line))
    .join('\n');
}

function createNormalizedSseBody(body: any): any {
  const TransformStreamCtor = (globalThis as any).TransformStream;
  if (!body || !TransformStreamCtor) return undefined;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';

  return body.pipeThrough(new TransformStreamCtor({
    transform(chunk: Uint8Array, controller: any) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      if (lines.length > 0) {
        controller.enqueue(encoder.encode(`${normalizeMimoSseText(lines.join('\n'))}\n`));
      }
    },
    flush(controller: any) {
      pending += decoder.decode();
      if (pending) {
        controller.enqueue(encoder.encode(normalizeMimoSseText(pending)));
      }
    },
  }));
}

async function normalizeFetchResponse(response: FetchResult): Promise<FetchResult> {
  const contentType = response.headers.get('content-type') || '';
  const ResponseCtor = (globalThis as any).Response;
  if (!ResponseCtor) return response;

  const headers = headersWithoutContentLength(response.headers) as any;
  if (contentType.includes('text/event-stream')) {
    const body = createNormalizedSseBody(response.body);
    return body
      ? new ResponseCtor(body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      : response;
  }

  if (!contentType.includes('application/json')) return response;

  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    const changed = normalizeMimoChatCompletionPayload(payload);
    return new ResponseCtor(changed ? JSON.stringify(payload) : text, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return new ResponseCtor(text, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

export function createMimoReasoningContentFetch(baseFetch: FetchLike = fetch): FetchLike {
  return (async (input: FetchInput, init?: FetchInit): Promise<FetchResult> => {
    const normalizedRequest = await normalizeFetchRequest(input, init);
    const response = await baseFetch(normalizedRequest.input, normalizedRequest.init);
    return normalizedRequest.isChatCompletions
      ? normalizeFetchResponse(response)
      : response;
  }) as FetchLike;
}
