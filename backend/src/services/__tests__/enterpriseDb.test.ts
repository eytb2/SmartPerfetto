// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  openEnterpriseDb,
  resolveEnterpriseDbPath,
  ENTERPRISE_DB_PATH_ENV,
} from '../enterpriseDb';

describe('enterprise SQLite WAL database', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  test('resolves the configured database path', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-enterprise-db-'));
    const configuredPath = path.join(tmpDir, 'enterprise.sqlite');

    expect(resolveEnterpriseDbPath({
      [ENTERPRISE_DB_PATH_ENV]: configuredPath,
    } as NodeJS.ProcessEnv)).toBe(configuredPath);
  });

  test('opens SQLite with WAL, foreign keys, busy timeout, and schema migrations', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-enterprise-db-'));
    const dbPath = path.join(tmpDir, 'enterprise.sqlite');
    const db = openEnterpriseDb(dbPath);

    try {
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);

      const rows = db.prepare<unknown[], { version: number }>(
        'SELECT version FROM enterprise_schema_migrations ORDER BY version',
      ).all();
      expect(rows).toEqual([
        { version: 1 },
        { version: 2 },
        { version: 3 },
        { version: 4 },
        { version: 5 },
        { version: 6 },
      ]);
    } finally {
      db.close();
    }
  });
});
