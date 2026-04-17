// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Per-turn persistence helper shared by `analyze` and `resume`.
 *
 * Both commands end a turn with the same fan-out: write conclusion +
 * per-turn markdown + HTML report + config + transcript + index entry,
 * then render the conclusion block and the completion summary. This
 * helper owns those eight steps so the call sites stay short and
 * uniform — any future addition (e.g. a `--no-report` flag) only
 * touches one place.
 */

import type { CliPaths, SessionPaths } from '../io/paths';
import type { Renderer } from '../repl/renderer';
import type { CliSessionConfig, CliSessionIndexEntry } from '../types';
import type { RunTurnOutput } from './cliAnalyzeService';
import {
  writeConfig,
  writeConclusion,
  writeReportHtml,
  writeTurnMarkdown,
} from '../io/sessionStore';
import { upsertSession } from '../io/indexJson';
import { appendTranscriptTurn } from '../io/transcriptWriter';

export interface CommitTurnInput {
  paths: CliPaths;
  sp: SessionPaths;
  renderer: Renderer;

  /** User-facing session id. For resume this equals the input session id;
   *  for a fresh analyze it equals `result.sessionId`. */
  sessionId: string;
  /** 1-indexed. */
  turn: number;
  /** The user's question for this turn. */
  query: string;
  /** Output of CliAnalyzeService.runTurn(). */
  result: RunTurnOutput;
  /** Caller-constructed config. This helper persists it verbatim. */
  config: CliSessionConfig;
  /** Pre-formatted markdown for `turns/NNN.md`. */
  turnMarkdown: string;
  /** Caller-constructed index row. */
  indexEntry: CliSessionIndexEntry;
}

export function commitTurnOutputs(input: CommitTurnInput): void {
  const { paths, sp, renderer, sessionId, turn, query, result, config, turnMarkdown, indexEntry } = input;

  const conclusion = result.result.conclusion || '';

  writeConclusion(sp, conclusion);
  writeTurnMarkdown(sp, turn, turnMarkdown);

  const reportPathForUser = result.reportHtml
    ? (writeReportHtml(sp, result.reportHtml), sp.report)
    : `(report generation failed${result.reportError ? `: ${result.reportError}` : ''})`;

  writeConfig(sp, config);

  appendTranscriptTurn(sp.transcript, {
    turn,
    timestamp: config.lastTurnAt,
    question: query,
    conclusionMd: conclusion,
    confidence: result.result.confidence,
    rounds: result.result.rounds,
    durationMs: result.result.totalDurationMs,
    reportFile: result.reportHtml ? sp.report : undefined,
    error: result.reportError,
  });

  upsertSession(paths, indexEntry);

  renderer.printConclusion(conclusion, {
    confidence: result.result.confidence,
    rounds: result.result.rounds,
    durationMs: result.result.totalDurationMs,
  });
  renderer.printCompletion({
    reportPath: reportPathForUser,
    sessionDir: sp.dir,
    sessionId,
  });
}
