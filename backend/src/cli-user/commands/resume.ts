// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * `smartperfetto resume <sessionId> --query <...>` — continue a prior session.
 *
 * Three-level degradation (plan §G.3):
 *   Level 1 — reloadTraceById(oldTraceId) succeeds → reuse sessionId +
 *             sdkSessionId → SDK context fully resumed.
 *   Level 2 — same as Level 1 but the SDK's own resume fails internally.
 *             Not detectable from the CLI side; the orchestrator silently
 *             starts a fresh SDK conversation. No special handling.
 *   Level 3 — trace evicted from `uploads/traces/`. Fall back to a fresh
 *             load via `tracePath`. The backend-side `result.sessionId`
 *             changes (new SDK session internally), but from the user's
 *             point of view it's still the same CLI session: we keep
 *             writing to the same folder, increment the same turnCount,
 *             and preserve the index entry.
 *
 * Out of scope for PR2: no-arg resume that infers sessionId from cwd.
 * That's a REPL-adjacent ergonomic feature — deferred to PR3.
 */

import * as fs from 'fs';
import * as path from 'path';
import { bootstrap } from '../bootstrap';
import { CliAnalyzeService } from '../services/cliAnalyzeService';
import { commitTurnOutputs } from '../services/turnPersistence';
import { createRenderer } from '../repl/renderer';
import { sessionPaths, ensureSessionLayout } from '../io/paths';
import { loadSession } from '../io/sessionStore';
import { readIndex } from '../io/indexJson';
import { appendStreamEvent } from '../io/transcriptWriter';
import type { CliSessionConfig } from '../types';

export interface ResumeCommandArgs {
  sessionId: string;
  query: string;
  envFile?: string;
  sessionDir?: string;
  verbose: boolean;
  noColor: boolean;
}

/** Truncation bound for preamble injection — keeps prompt under ~2KB. */
const PREAMBLE_MAX_CHARS = 1500;

export async function runResumeCommand(args: ResumeCommandArgs): Promise<number> {
  const { paths } = bootstrap({ envFile: args.envFile, sessionDir: args.sessionDir });
  const renderer = createRenderer({ verbose: args.verbose, useColor: !args.noColor });
  const service = new CliAnalyzeService();

  const userSessionId = args.sessionId;
  const sp = sessionPaths(paths, userSessionId);
  const { config: existingConfig } = loadSession(paths, userSessionId);
  if (!existingConfig) {
    console.error(`Error: no session found at ${sp.dir}`);
    return 1;
  }

  const nextTurn = existingConfig.turnCount + 1;
  // Folder already exists (config was just loaded), so streamFile is safe to set
  // up front — no need to wait for onSessionReady.
  const streamFile = sp.stream;

  try {
    console.log(`Resuming session ${userSessionId} (turn ${nextTurn})`);
    const reloaded = await service.reloadTraceById(existingConfig.traceId);

    let effectiveTraceId: string;
    let effectiveQuery: string;
    let requestedSessionId: string | undefined;
    let degraded = false;

    if (reloaded) {
      // Level 1/2: trace intact, reuse persisted session id so the backend
      // restores EnhancedSessionContext / FocusStore / runtime arrays and
      // ClaudeRuntime resumes the SDK session from `claude_session_map.json`.
      effectiveTraceId = existingConfig.traceId;
      effectiveQuery = args.query;
      requestedSessionId = userSessionId;
      console.log(`Trace reloaded (traceId=${effectiveTraceId.slice(0, 8)}…)`);
    } else {
      // Level 3: load fresh and inject prior conclusion as preamble. The
      // backend-side session is new (requestedSessionId undefined), but the
      // CLI folder stays put — the user's mental model of "same session"
      // holds even though the SDK context is gone.
      console.log('(trace evicted from cache — loading fresh and replaying conclusion as preamble)');
      effectiveTraceId = await service.loadTrace(existingConfig.tracePath);
      effectiveQuery = buildPreambleQuery(sp.conclusion, args.query);
      requestedSessionId = undefined;
      degraded = true;
    }

    const result = await service.runTurn({
      traceId: effectiveTraceId,
      query: effectiveQuery,
      sessionId: requestedSessionId,
      // Stream events write straight to the already-existing folder. We don't
      // need to track sessionId from onSessionReady because we commit outputs
      // under `userSessionId`, not whatever backend id runTurn produces.
      onSessionReady: () => {
        ensureSessionLayout(sp);
      },
      onEvent: (update) => {
        renderer.onEvent(update);
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

    // Preserve index metadata (createdAt, firstQuery, traceFilename) across turns —
    // these describe the session's origin, not its latest state.
    const idx = readIndex(paths);
    const prev = idx.sessions[userSessionId];
    commitTurnOutputs({
      paths,
      sp,
      renderer,
      sessionId: userSessionId,
      turn: nextTurn,
      query: args.query,
      result,
      config: updatedConfig,
      turnMarkdown: formatTurnMarkdown(nextTurn, args.query, result.result.conclusion || '', result.result, degraded),
      indexEntry: {
        sessionId: userSessionId,
        createdAt: prev?.createdAt ?? existingConfig.createdAt,
        lastTurnAt: now,
        tracePath: existingConfig.tracePath,
        traceFilename: prev?.traceFilename ?? path.basename(existingConfig.tracePath),
        firstQuery: prev?.firstQuery ?? args.query,
        turnCount: nextTurn,
        status: result.result.success ? 'completed' : 'failed',
      },
    });

    if (degraded) {
      console.log('\nnote: SDK context was unavailable — replayed prior conclusion as preamble.');
    }

    return 0;
  } catch (err) {
    renderer.printError((err as Error).message);
    return 1;
  } finally {
    await service.shutdown();
  }
}

/** Wrap the user's query with the prior conclusion so content continuity survives
 *  even when the SDK context is gone. */
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
