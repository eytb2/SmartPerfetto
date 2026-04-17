// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * CLI bootstrap: env loading + path layout + API key validation.
 *
 * Invariant: callers must await `bootstrap()` once before any CLI command
 * performs work. Idempotent within a process — safe to call twice.
 *
 * Notes on process liveness:
 *   We intentionally do NOT import `reportRoutes.ts` anywhere in the CLI
 *   path — that module installs a 30-minute setInterval without `.unref()`,
 *   which would keep the CLI process alive indefinitely after analyze
 *   completes. Instead, CLI writes its HTML report directly to the session
 *   folder via `sessionStore.writeReportHtml`.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { computePaths, ensureLayout, type CliPaths } from './io/paths';

export interface BootstrapOptions {
  envFile?: string;
  sessionDir?: string;
  /** When false, skip the ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL check so
   *  purely-local commands (`list`, `show`, `report`, `rm`) stay usable
   *  before the user has configured LLM credentials. Defaults to true. */
  requireLlm?: boolean;
}

export interface BootstrapResult {
  paths: CliPaths;
}

let memoizedResult: BootstrapResult | null = null;
let llmCredentialsVerified = false;

export function bootstrap(options: BootstrapOptions = {}): BootstrapResult {
  const requireLlm = options.requireLlm !== false;

  if (!memoizedResult) {
    loadEnv(options.envFile);
    const paths = computePaths(options.sessionDir);
    ensureLayout(paths);
    memoizedResult = { paths };
  }

  // Credentials check is separate from the memoization guard: a process
  // might first hit `bootstrap({requireLlm:false})` (list) and later an
  // LLM-using path — the second call must still enforce the check.
  if (requireLlm && !llmCredentialsVerified) {
    assertLlmCredentials();
    llmCredentialsVerified = true;
  }

  return memoizedResult;
}

/**
 * Load env from (in order, first wins):
 *   1. --env-file argument
 *   2. backend/.env relative to this compiled file
 *   3. ~/.smartperfetto/env
 *
 * Missing files are silently skipped; only an explicitly-passed --env-file
 * is required to exist.
 */
function loadEnv(explicitFile?: string): void {
  if (explicitFile) {
    const resolved = path.resolve(explicitFile);
    if (!fs.existsSync(resolved)) {
      throw new Error(`--env-file not found: ${resolved}`);
    }
    dotenv.config({ path: resolved, quiet: true });
    return;
  }

  // Try backend/.env (sibling of this module's package root).
  // __dirname at runtime will be something like dist/cli-user or src/cli-user.
  // Walk up to find the first ancestor containing package.json with our name.
  const backendEnv = findBackendEnv();
  if (backendEnv) dotenv.config({ path: backendEnv, quiet: true });

  // Last chance: user-level override.
  const userEnv = path.join(process.env.HOME || '', '.smartperfetto', 'env');
  if (fs.existsSync(userEnv)) dotenv.config({ path: userEnv, quiet: true });
}

function findBackendEnv(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'smart-perfetto-backend') {
          const envPath = path.join(dir, '.env');
          return fs.existsSync(envPath) ? envPath : null;
        }
      } catch {
        // fall through to parent
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function assertLlmCredentials(): void {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasProxy = Boolean(process.env.ANTHROPIC_BASE_URL);
  if (hasKey || hasProxy) return;
  throw new Error(
    [
      'Missing Claude credentials.',
      'Set ANTHROPIC_API_KEY (or ANTHROPIC_BASE_URL for proxy setups) before running.',
      'The CLI reads backend/.env by default; pass --env-file <path> to override.',
    ].join(' '),
  );
}
