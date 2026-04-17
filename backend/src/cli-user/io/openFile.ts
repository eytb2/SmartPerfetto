// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Cross-platform "open this path in the OS default handler".
 * Supports macOS (`open`) and Linux (`xdg-open`). Windows is out of scope
 * for PR2 — plan explicitly says macOS/Linux only.
 *
 * We detach the child so it doesn't keep the CLI process alive after exit,
 * and ignore its stdio so the handler's output doesn't pollute our terminal.
 */

import { spawn } from 'child_process';

export type OpenResult =
  | { ok: true }
  | { ok: false; reason: string };

export function openPath(target: string): OpenResult {
  const tool = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'linux'
      ? 'xdg-open'
      : null;

  if (!tool) {
    return { ok: false, reason: `--open is not supported on ${process.platform}` };
  }

  try {
    const child = spawn(tool, [target], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
