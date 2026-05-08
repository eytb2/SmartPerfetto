// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ENTERPRISE_FEATURE_FLAG_ENV } from '../../config';
import { ENTERPRISE_DB_PATH_ENV, openEnterpriseDb } from '../../services/enterpriseDb';
import { saveClaudeSessionMapToRuntimeSnapshots } from '../../services/runtimeSnapshotStore';
import { ClaudeRuntime } from '../claudeRuntime';

const originalEnv = {
  enterprise: process.env[ENTERPRISE_FEATURE_FLAG_ENV],
  enterpriseDbPath: process.env[ENTERPRISE_DB_PATH_ENV],
};

let tmpDir: string | undefined;
let dbPath: string;

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function runtimeSnapshotCount(): number {
  const db = openEnterpriseDb(dbPath);
  try {
    const row = db.prepare<unknown[], { count: number }>(
      'SELECT COUNT(*) AS count FROM runtime_snapshots',
    ).get();
    return row?.count ?? 0;
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-claude-runtime-snapshot-'));
  dbPath = path.join(tmpDir, 'enterprise.sqlite');
  process.env[ENTERPRISE_FEATURE_FLAG_ENV] = 'true';
  process.env[ENTERPRISE_DB_PATH_ENV] = dbPath;
});

afterEach(async () => {
  restoreEnvValue(ENTERPRISE_FEATURE_FLAG_ENV, originalEnv.enterprise);
  restoreEnvValue(ENTERPRISE_DB_PATH_ENV, originalEnv.enterpriseDbPath);
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe('ClaudeRuntime enterprise runtime_snapshots session map', () => {
  it('loads SDK session mappings from runtime_snapshots on construction', () => {
    saveClaudeSessionMapToRuntimeSnapshots({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      sessionId: 'session-a',
      runId: 'run-a',
      traceId: 'trace-a',
    }, 'session-a', {
      sdkSessionId: 'sdk-session-a',
      updatedAt: Date.now(),
    });

    const runtime = new ClaudeRuntime({} as any, {
      enableVerification: false,
      enableSubAgents: false,
    });

    expect(runtime.getSdkSessionId('session-a')).toBe('sdk-session-a');
  });

  it('removes enterprise runtime_snapshots rows during session cleanup', () => {
    saveClaudeSessionMapToRuntimeSnapshots({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      sessionId: 'session-a',
      runId: 'run-a',
      traceId: 'trace-a',
    }, 'session-a', {
      sdkSessionId: 'sdk-session-a',
      updatedAt: Date.now(),
    });
    expect(runtimeSnapshotCount()).toBe(1);

    const runtime = new ClaudeRuntime({} as any, {
      enableVerification: false,
      enableSubAgents: false,
    });

    runtime.removeSession('session-a');
    expect(runtimeSnapshotCount()).toBe(0);
  });
});
