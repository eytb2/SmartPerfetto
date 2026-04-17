// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * `smartperfetto resume <sessionId> --query <...>` — continue a prior session.
 *
 * Thin wrapper: shares `turnRunner.continueSession` with the REPL. The
 * three-level degradation (Level 1/2 trace reload, Level 3 fresh-load +
 * preamble) lives in the runner, not here — keep this file boring.
 */

import { bootstrap } from '../bootstrap';
import { CliAnalyzeService } from '../services/cliAnalyzeService';
import { createRenderer } from '../repl/renderer';
import { continueSession } from '../services/turnRunner';

export interface ResumeCommandArgs {
  sessionId: string;
  query: string;
  envFile?: string;
  sessionDir?: string;
  verbose: boolean;
  noColor: boolean;
}

export async function runResumeCommand(args: ResumeCommandArgs): Promise<number> {
  const { paths } = bootstrap({ envFile: args.envFile, sessionDir: args.sessionDir });
  const renderer = createRenderer({ verbose: args.verbose, useColor: !args.noColor });
  const service = new CliAnalyzeService();

  try {
    await continueSession({ paths, service, renderer }, {
      sessionId: args.sessionId,
      query: args.query,
    });
    return 0;
  } catch (err) {
    renderer.printError((err as Error).message);
    return 1;
  } finally {
    await service.shutdown();
  }
}
