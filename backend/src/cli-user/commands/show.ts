// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * `smartperfetto show <sessionId>` — print a session's latest conclusion
 * and report location. Optional `--open` opens the HTML report.
 */

import * as fs from 'fs';
import { bootstrap } from '../bootstrap';
import { loadSession } from '../io/sessionStore';
import { openPath } from '../io/openFile';

export interface ShowCommandArgs {
  sessionId: string;
  open: boolean;
  envFile?: string;
  sessionDir?: string;
}

export async function runShowCommand(args: ShowCommandArgs): Promise<number> {
  const { paths } = bootstrap({ envFile: args.envFile, sessionDir: args.sessionDir, requireLlm: false });
  const { sp, config } = loadSession(paths, args.sessionId);

  if (!config) {
    console.error(`Error: no session found at ${sp.dir}`);
    return 1;
  }

  // Header: session metadata. Short format — full details belong in `list --json`.
  console.log(`session  ${args.sessionId}`);
  console.log(`trace    ${config.tracePath}`);
  console.log(`turns    ${config.turnCount}`);
  console.log(`updated  ${new Date(config.lastTurnAt).toISOString()}`);
  console.log('');

  // Body: latest conclusion. Session folder always has conclusion.md after
  // the first turn — if it's missing the session is corrupt or mid-analysis.
  if (fs.existsSync(sp.conclusion)) {
    console.log(fs.readFileSync(sp.conclusion, 'utf-8'));
  } else {
    console.log('(no conclusion yet — session is pending or incomplete)');
  }

  // Footer: report pointer. Surface always, even without --open, so the user
  // can copy it into a browser manually.
  if (fs.existsSync(sp.report)) {
    console.log(`\nreport: ${sp.report}`);
    if (args.open) {
      const r = openPath(sp.report);
      if (!r.ok) console.error(`(open failed: ${r.reason})`);
    }
  } else if (args.open) {
    console.error('(no report.html in session folder — nothing to open)');
  }

  return 0;
}
