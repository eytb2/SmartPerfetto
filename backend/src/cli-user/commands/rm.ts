// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * `smartperfetto rm <sessionId>` — delete the local session folder.
 *
 * Scope note: this ONLY touches `~/.smartperfetto/sessions/<id>/` and the
 * global index. The backend-side persisted state (`backend/data/sessions/
 * sessions.db`) is intentionally untouched — users may still want to see
 * the session in the web UI, and removing it from SQLite is the backend's
 * responsibility (a separate cleanup command could be added later if needed).
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { bootstrap } from '../bootstrap';
import { loadSession } from '../io/sessionStore';
import { readIndex, writeIndex } from '../io/indexJson';

export interface RmCommandArgs {
  sessionId: string;
  yes: boolean;
  envFile?: string;
  sessionDir?: string;
}

export async function runRmCommand(args: RmCommandArgs): Promise<number> {
  const { paths } = bootstrap({ envFile: args.envFile, sessionDir: args.sessionDir, requireLlm: false });
  const { sp, config } = loadSession(paths, args.sessionId);

  if (!config) {
    console.error(`Error: no session found at ${sp.dir}`);
    return 1;
  }

  if (!args.yes) {
    // readline.question hangs forever on stdin when it's not a TTY (CI,
    // piped input). Require --yes explicitly in that case so scripted use
    // fails fast instead of appearing to stall.
    if (!process.stdin.isTTY) {
      console.error(`Error: non-interactive shell — pass --yes to delete ${args.sessionId} without confirmation.`);
      return 1;
    }
    const ok = await confirm(
      `Delete session ${args.sessionId} (${config.turnCount} turn${config.turnCount === 1 ? '' : 's'}, trace: ${config.tracePath})? [y/N] `,
    );
    if (!ok) {
      console.log('Cancelled.');
      return 0;
    }
  }

  fs.rmSync(sp.dir, { recursive: true, force: true });

  const idx = readIndex(paths);
  delete idx.sessions[args.sessionId];
  writeIndex(paths, idx);

  console.log(`Removed ${args.sessionId}`);
  return 0;
}

function confirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}
