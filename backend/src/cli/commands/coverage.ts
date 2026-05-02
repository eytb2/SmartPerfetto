// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Coverage Command (Spark Plan 01)
 *
 * Surfaces the StdlibSkillCoverageContract on the CLI.
 *   smart-perfetto coverage                # human-readable summary
 *   smart-perfetto coverage --json         # full contract
 *   smart-perfetto coverage --snapshot     # also persist current stdlib catalog
 *   smart-perfetto coverage --uncovered    # only print uncovered modules
 */

import {Command} from 'commander';
import {
  analyzeStdlibSkillCoverage,
  persistStdlibSnapshot,
} from '../../services/stdlibSkillCoverage';

const colors = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
};

interface CoverageOptions {
  json?: boolean;
  snapshot?: boolean;
  uncovered?: boolean;
}

/**
 * Run the analyzer with stdout redirected to stderr while it runs, so the
 * stdlib + skill loaders' `[StdlibScanner]`/`[SkillLoader]` status lines
 * don't pollute machine-parseable JSON output. Codex review caught that
 * the JSON path was unparseable for scripts because of these logs.
 */
async function analyzeQuietly(): ReturnType<typeof analyzeStdlibSkillCoverage> {
  const originalLog = console.log;
  console.log = (...args: unknown[]) => console.error(...args);
  try {
    return await analyzeStdlibSkillCoverage();
  } finally {
    console.log = originalLog;
  }
}

export const coverageCommand = new Command('coverage')
  .description('Stdlib catalog × Skill prerequisite coverage report (Spark Plan 01)')
  .option('--json', 'Emit the full StdlibSkillCoverageContract as JSON')
  .option('--snapshot', 'Persist current stdlib module list for future watcher diff')
  .option('--uncovered', 'Print only the uncovered stdlib modules list')
  .action(async (options: CoverageOptions) => {
    const contract = options.json
      ? await analyzeQuietly()
      : await analyzeStdlibSkillCoverage();

    if (options.snapshot) {
      persistStdlibSnapshot();
    }

    if (options.json) {
      console.log(JSON.stringify(contract, null, 2));
      return;
    }

    if (contract.unsupportedReason) {
      console.log(colors.red(`UNSUPPORTED: ${contract.unsupportedReason}`));
      process.exitCode = 1;
      return;
    }

    if (options.uncovered) {
      console.log(colors.bold(`Uncovered stdlib modules (${contract.uncoveredModules.length}):`));
      for (const m of contract.uncoveredModules) {
        console.log(`  - ${m.module}`);
      }
      return;
    }

    const coveragePct = contract.totalModules > 0
      ? ((contract.modulesCovered / contract.totalModules) * 100).toFixed(1)
      : '0.0';

    console.log(colors.bold('\nStdlib × Skill Coverage Report\n'));
    console.log(`  Stdlib modules total:   ${colors.cyan(String(contract.totalModules))}`);
    console.log(`  Modules covered:        ${colors.cyan(String(contract.modulesCovered))} (${coveragePct}%)`);
    console.log(`  Skills with drift:      ${colors.cyan(String(contract.skillsWithDrift))}`);
    console.log(`  Uncovered modules:      ${colors.cyan(String(contract.uncoveredModules.length))}`);

    if (contract.newlyAddedModules && contract.newlyAddedModules.length > 0) {
      console.log(colors.yellow(`\n  ⚠ ${contract.newlyAddedModules.length} new stdlib modules since last snapshot:`));
      for (const m of contract.newlyAddedModules.slice(0, 10)) {
        console.log(`    + ${m.module}`);
      }
      if (contract.newlyAddedModules.length > 10) {
        console.log(colors.gray(`    ... ${contract.newlyAddedModules.length - 10} more`));
      }
    }

    const drifted = contract.skillUsage
      .filter(u => u.declaredButUnused.length > 0 || u.detectedButUndeclared.length > 0)
      .slice(0, 10);

    if (drifted.length > 0) {
      console.log(colors.bold('\nDrifted skills (first 10):'));
      for (const u of drifted) {
        console.log(`  ${colors.yellow(u.skillId)}`);
        if (u.declaredButUnused.length > 0) {
          console.log(`    declared but not used: ${u.declaredButUnused.join(', ')}`);
        }
        if (u.detectedButUndeclared.length > 0) {
          console.log(`    used but not declared: ${u.detectedButUndeclared.join(', ')}`);
        }
      }
    }

    if (options.snapshot) {
      console.log(colors.green('\n✓ Snapshot persisted.'));
    }
  });
