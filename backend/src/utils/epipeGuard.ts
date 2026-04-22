// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Install EPIPE crash prevention handlers.
 * Prevents the process from crashing when writing to a closed pipe/socket
 * (e.g., SSE client disconnected, SDK stream broke, tee in start-dev.sh killed).
 *
 * @param onFatalException - Called for non-EPIPE uncaught exceptions.
 *   Defaults to logging + process.exit(1).
 */
export function installEpipeGuard(
  onFatalException?: (error: Error) => void,
): void {
  process.stdout?.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') return;
    throw err;
  });
  process.stderr?.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') return;
    throw err;
  });
  process.on('uncaughtException', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') {
      console.warn('[EPIPE] Write to closed pipe (non-fatal):', error.message);
      return;
    }
    if (onFatalException) {
      onFatalException(error);
    } else {
      console.error('Uncaught Exception:', error);
      process.exit(1);
    }
  });
}
