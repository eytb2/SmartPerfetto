// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Turn runner — the shared per-turn flow used by `analyze`, `resume`,
 * and the REPL.
 *
 * Responsibilities:
 *   - Load / reload trace
 *   - Call CliAnalyzeService.runTurn()
 *   - Commit outputs to the session folder via `commitTurnOutputs`
 *
 * Out of scope:
 *   - Bootstrap (env/paths) — caller owns this
 *   - Service construction / teardown — caller owns the lifecycle
 *     (one-shot commands wrap a single turn; REPL keeps one service
 *      across many turns)
 *   - Error presentation beyond propagating exceptions
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CliPaths, SessionPaths } from '../io/paths';
import { ensureSessionLayout, sessionPaths } from '../io/paths';
import type { Renderer } from '../repl/renderer';
import type { CliSessionConfig } from '../types';
import type { CliAnalyzeService } from './cliAnalyzeService';
import { commitTurnOutputs } from './turnPersistence';
import { loadSession } from '../io/sessionStore';
import { readIndex } from '../io/indexJson';
import { appendStreamEvent } from '../io/transcriptWriter';

/** Max chars of prior conclusion replayed as preamble on Level 3 resume. */
const PREAMBLE_MAX_CHARS = 1500;

export interface TurnRunnerContext {
  paths: CliPaths;
  service: CliAnalyzeService;
  renderer: Renderer;
}

export interface TurnResult {
  sessionId: string;
  sessionDir: string;
  turn: number;
  success: boolean;
  /** True when the resume path had to fall back to Level 3 (fresh load +
   *  preamble). Callers can surface a note to the user. */
  degraded: boolean;
}

/**
 * Fresh analyze — loads the trace, creates a new session, runs turn 1.
 * Equivalent to what `smartperfetto analyze <trace>` does, minus the
 * bootstrap / service-lifecycle work around it.
 */
export async function startSession(
  ctx: TurnRunnerContext,
  input: { tracePath: string; query: string },
): Promise<TurnResult> {
  const tracePath = path.resolve(input.tracePath);
  console.log(`Loading trace: ${tracePath}`);
  // loadTraceFromFilePath throws on ENOENT; we let it propagate so there's
  // one source of truth for the existence check.
  const traceId = await ctx.service.loadTrace(tracePath);
  console.log(`Trace loaded (traceId=${traceId.slice(0, 8)}…)`);

  const startedAt = Date.now();
  let sp: SessionPaths | undefined;
  let streamFile: string | null = null;
  let resolvedSessionId: string | undefined;

  const result = await ctx.service.runTurn({
    traceId,
    query: input.query,
    onSessionReady: (sid) => {
      sp = sessionPaths(ctx.paths, sid);
      ensureSessionLayout(sp);
      resolvedSessionId = sid;
      streamFile = sp.stream;
    },
    onEvent: (update) => {
      ctx.renderer.onEvent(update);
      if (streamFile) appendStreamEvent(streamFile, update);
    },
  });

  // Defensive: if onSessionReady didn't fire (future refactor hazard) we
  // still land on a valid session folder using the resolved sessionId.
  if (!resolvedSessionId || !sp) {
    resolvedSessionId = result.sessionId;
    sp = sessionPaths(ctx.paths, resolvedSessionId);
    ensureSessionLayout(sp);
  }
  const now = Date.now();

  const config: CliSessionConfig = {
    sessionId: resolvedSessionId,
    tracePath,
    traceId,
    sdkSessionId: result.sdkSessionId,
    model: result.model,
    createdAt: startedAt,
    lastTurnAt: now,
    turnCount: 1,
  };

  commitTurnOutputs({
    paths: ctx.paths,
    sp,
    renderer: ctx.renderer,
    sessionId: resolvedSessionId,
    turn: 1,
    query: input.query,
    result,
    config,
    turnMarkdown: formatTurnMarkdown(1, input.query, result.result.conclusion || '', result.result, false),
    indexEntry: {
      sessionId: resolvedSessionId,
      createdAt: startedAt,
      lastTurnAt: now,
      tracePath,
      traceFilename: path.basename(tracePath),
      firstQuery: input.query,
      turnCount: 1,
      status: result.result.success ? 'completed' : 'failed',
    },
  });

  return {
    sessionId: resolvedSessionId,
    sessionDir: sp.dir,
    turn: 1,
    success: result.result.success,
    degraded: false,
  };
}

/**
 * Continue an existing session — reloads the trace (with the original id
 * when possible), runs turn N+1, and commits outputs to the same folder.
 *
 * Three-level degradation (plan §G.3): Level 1/2 keep sessionId+sdkSessionId
 * intact; Level 3 falls back to a fresh load with the prior conclusion
 * injected as preamble but keeps the CLI-visible session id stable.
 */
export async function continueSession(
  ctx: TurnRunnerContext,
  input: { sessionId: string; query: string },
): Promise<TurnResult> {
  const userSessionId = input.sessionId;
  const sp = sessionPaths(ctx.paths, userSessionId);
  const { config: existingConfig } = loadSession(ctx.paths, userSessionId);
  if (!existingConfig) {
    throw new Error(`no session found at ${sp.dir}`);
  }

  const nextTurn = existingConfig.turnCount + 1;
  const streamFile = sp.stream;

  console.log(`Resuming session ${userSessionId} (turn ${nextTurn})`);
  const reloaded = await ctx.service.reloadTraceById(existingConfig.traceId);

  let effectiveTraceId: string;
  let effectiveQuery: string;
  let requestedSessionId: string | undefined;
  let degraded = false;

  if (reloaded) {
    effectiveTraceId = existingConfig.traceId;
    effectiveQuery = input.query;
    requestedSessionId = userSessionId;
    console.log(`Trace reloaded (traceId=${effectiveTraceId.slice(0, 8)}…)`);
  } else {
    console.log('(trace evicted from cache — loading fresh and replaying conclusion as preamble)');
    effectiveTraceId = await ctx.service.loadTrace(existingConfig.tracePath);
    effectiveQuery = buildPreambleQuery(sp.conclusion, input.query);
    requestedSessionId = undefined;
    degraded = true;
  }

  const result = await ctx.service.runTurn({
    traceId: effectiveTraceId,
    query: effectiveQuery,
    sessionId: requestedSessionId,
    onSessionReady: () => {
      ensureSessionLayout(sp);
    },
    onEvent: (update) => {
      ctx.renderer.onEvent(update);
      appendStreamEvent(streamFile, update);
    },
  });

  const now = Date.now();
  const updatedConfig: CliSessionConfig = {
    ...existingConfig,
    sessionId: userSessionId,
    traceId: effectiveTraceId,
    sdkSessionId: result.sdkSessionId || existingConfig.sdkSessionId,
    model: result.model || existingConfig.model,
    lastTurnAt: now,
    turnCount: nextTurn,
  };

  const idx = readIndex(ctx.paths);
  const prev = idx.sessions[userSessionId];

  commitTurnOutputs({
    paths: ctx.paths,
    sp,
    renderer: ctx.renderer,
    sessionId: userSessionId,
    turn: nextTurn,
    query: input.query,
    result,
    config: updatedConfig,
    turnMarkdown: formatTurnMarkdown(nextTurn, input.query, result.result.conclusion || '', result.result, degraded),
    indexEntry: {
      sessionId: userSessionId,
      createdAt: prev?.createdAt ?? existingConfig.createdAt,
      lastTurnAt: now,
      tracePath: existingConfig.tracePath,
      traceFilename: prev?.traceFilename ?? path.basename(existingConfig.tracePath),
      firstQuery: prev?.firstQuery ?? input.query,
      turnCount: nextTurn,
      status: result.result.success ? 'completed' : 'failed',
    },
  });

  if (degraded) {
    console.log('\nnote: SDK context was unavailable — replayed prior conclusion as preamble.');
  }

  return {
    sessionId: userSessionId,
    sessionDir: sp.dir,
    turn: nextTurn,
    success: result.result.success,
    degraded,
  };
}

function buildPreambleQuery(conclusionFile: string, userQuery: string): string {
  let preamble = '';
  try {
    preamble = fs.readFileSync(conclusionFile, 'utf-8');
  } catch {
    // Missing or unreadable — fall through to a plain fresh run.
  }
  if (!preamble.trim()) return userQuery;

  const trimmed = preamble.length > PREAMBLE_MAX_CHARS
    ? `${preamble.slice(0, PREAMBLE_MAX_CHARS)}…（已截断）`
    : preamble;

  return [
    '（continuing prior analysis; previous conclusion below）',
    '---',
    trimmed,
    '---',
    `用户新问题: ${userQuery}`,
  ].join('\n');
}

function formatTurnMarkdown(
  turn: number,
  query: string,
  conclusion: string,
  result: { confidence: number; rounds: number; totalDurationMs: number },
  degraded: boolean,
): string {
  const lines: string[] = [
    `# Turn ${turn}`,
    ``,
    `**Question**: ${query}`,
    ``,
    `**Confidence**: ${(result.confidence * 100).toFixed(0)}%  ·  **Rounds**: ${result.rounds}  ·  **Duration**: ${(result.totalDurationMs / 1000).toFixed(1)}s`,
    ``,
  ];
  if (degraded) {
    lines.push(`> _Note: SDK context was unavailable for this turn — prior conclusion was replayed as preamble._`, ``);
  }
  lines.push('## Conclusion', '', conclusion || '*(empty)*', '');
  return lines.join('\n');
}
