#!/usr/bin/env tsx
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import {
  buildEnterpriseMigrationDryRun,
  createEnterpriseMigrationSnapshot,
  describeEnterpriseMigrationRollback,
  restoreEnterpriseMigrationSnapshot,
} from '../services/enterpriseMigration';

function usage(): never {
  console.error([
    'Usage:',
    '  tsx src/scripts/enterpriseMigrationSnapshot.ts --dry-run [--snapshot-dir <dir>]',
    '  tsx src/scripts/enterpriseMigrationSnapshot.ts --snapshot [--snapshot-dir <dir>]',
    '  tsx src/scripts/enterpriseMigrationSnapshot.ts --restore <snapshot-dir>',
  ].join('\n'));
  process.exit(2);
}

function argValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0) return undefined;
  const value = args[idx + 1];
  if (!value || value.startsWith('--')) usage();
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const snapshotRoot = argValue(args, '--snapshot-dir');
  const restoreDir = argValue(args, '--restore');
  if (restoreDir) {
    const result = await restoreEnterpriseMigrationSnapshot(restoreDir);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.includes('--dry-run')) {
    const report = buildEnterpriseMigrationDryRun({snapshotRoot});
    console.log(JSON.stringify({
      ...report,
      rollback: describeEnterpriseMigrationRollback(),
    }, null, 2));
    return;
  }

  if (args.includes('--snapshot')) {
    const manifest = await createEnterpriseMigrationSnapshot({snapshotRoot});
    console.log(JSON.stringify({
      ...manifest,
      rollback: describeEnterpriseMigrationRollback(),
    }, null, 2));
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
