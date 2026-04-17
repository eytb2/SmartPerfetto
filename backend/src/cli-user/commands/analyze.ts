// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * `smartperfetto analyze <trace>` — one-shot analysis.
 *
 * Responsibilities are split between this file and helpers:
 *   - Trace load + runTurn orchestration live here.
 *   - The 8-step "end of turn" persistence (conclusion/report/config/
 *     transcript/index + terminal render) lives in `turnPersistence.ts`
 *     so `resume.ts` can share it exactly.
 */

import * as path from 'path';
import { bootstrap } from '../bootstrap';
import { CliAnalyzeService } from '../services/cliAnalyzeService';
import { commitTurnOutputs } from '../services/turnPersistence';
import { createRenderer } from '../repl/renderer';
import { sessionPaths, ensureSessionLayout } from '../io/paths';
import { upsertSession } from '../io/indexJson';
import { appendStreamEvent } from '../io/transcriptWriter';
import type { CliSessionConfig } from '../types';

export interface AnalyzeCommandArgs {
  trace: string;
  query: string;
  envFile?: string;
  sessionDir?: string;
  verbose: boolean;
  noColor: boolean;
}

export async function runAnalyzeCommand(args: AnalyzeCommandArgs): Promise<number> {
  const tracePath = path.resolve(args.trace);
  const { paths } = bootstrap({ envFile: args.envFile, sessionDir: args.sessionDir });
  const renderer = createRenderer({ verbose: args.verbose, useColor: !args.noColor });
  const service = new CliAnalyzeService();

  const startedAt = Date.now();
  let sessionId: string | undefined;
  let streamFile: string | null = null;

  try {
    console.log(`Loading trace: ${tracePath}`);
    // loadTraceFromFilePath throws if the file doesn't exist — we let that
    // bubble up so there's only one source of truth for the ENOENT check.
    const traceId = await service.loadTrace(tracePath);
    console.log(`Trace loaded (traceId=${traceId.slice(0, 8)}…)`);

    const result = await service.runTurn({
      traceId,
      query: args.query,
      // prepareSession fires this synchronously before analyze() starts streaming.
      // Creating the session folder here lets the event handler write straight to
      // disk — no in-memory event buffer, bounded memory regardless of run length.
      onSessionReady: (sid) => {
        const sp = sessionPaths(paths, sid);
        ensureSessionLayout(sp);
        sessionId = sid;
        streamFile = sp.stream;
      },
      onEvent: (update) => {
        renderer.onEvent(update);
        if (streamFile) appendStreamEvent(streamFile, update);
      },
    });

    // Defensive fallback — onSessionReady should always fire, but if a future
    // refactor breaks that contract we still end up with a valid session folder.
    if (!sessionId) {
      sessionId = result.sessionId;
      ensureSessionLayout(sessionPaths(paths, sessionId));
    }
    const sp = sessionPaths(paths, sessionId);
    const now = Date.now();

    const config: CliSessionConfig = {
      sessionId,
      tracePath,
      traceId,
      sdkSessionId: result.sdkSessionId,
      model: result.model,
      createdAt: startedAt,
      lastTurnAt: now,
      turnCount: 1,
    };

    commitTurnOutputs({
      paths,
      sp,
      renderer,
      sessionId,
      turn: 1,
      query: args.query,
      result,
      config,
      turnMarkdown: formatTurnMarkdown(args.query, result.result.conclusion || '', result.result),
      indexEntry: {
        sessionId,
        createdAt: startedAt,
        lastTurnAt: now,
        tracePath,
        traceFilename: path.basename(tracePath),
        firstQuery: args.query,
        turnCount: 1,
        status: result.result.success ? 'completed' : 'failed',
      },
    });

    return 0;
  } catch (err) {
    renderer.printError((err as Error).message);
    if (sessionId) {
      try {
        upsertSession(paths, {
          sessionId,
          createdAt: startedAt,
          lastTurnAt: Date.now(),
          tracePath,
          traceFilename: path.basename(tracePath),
          firstQuery: args.query,
          turnCount: 1,
          status: 'failed',
        });
      } catch { /* best-effort — don't mask the original error */ }
    }
    return 1;
  } finally {
    await service.shutdown();
  }
}

function formatTurnMarkdown(
  query: string,
  conclusion: string,
  result: { confidence: number; rounds: number; totalDurationMs: number },
): string {
  const lines: string[] = [
    `# Turn 1`,
    ``,
    `**Question**: ${query}`,
    ``,
    `**Confidence**: ${(result.confidence * 100).toFixed(0)}%  ·  **Rounds**: ${result.rounds}  ·  **Duration**: ${(result.totalDurationMs / 1000).toFixed(1)}s`,
    ``,
    `## Conclusion`,
    ``,
    conclusion || '*(empty)*',
    ``,
  ];
  return lines.join('\n');
}
