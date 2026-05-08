// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  ENTERPRISE_DB_PATH_ENV,
  openEnterpriseDb,
} from '../enterpriseDb';
import {
  getAnalysisRunLifecycle,
  heartbeatAnalysisRun,
  isAnalysisRunHeartbeatFresh,
  persistAnalysisRunState,
  resetAnalysisRunStoreForTests,
  type AnalysisRunPersistenceScope,
} from '../analysisRunStore';

const originalDbPath = process.env[ENTERPRISE_DB_PATH_ENV];
let tmpDir: string;

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function scope(overrides: Partial<AnalysisRunPersistenceScope> = {}): AnalysisRunPersistenceScope {
  return {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    userId: 'user-a',
    sessionId: 'session-a',
    runId: 'run-a',
    traceId: 'trace-a',
    query: 'why is this trace slow?',
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-analysis-runs-'));
  process.env[ENTERPRISE_DB_PATH_ENV] = path.join(tmpDir, 'enterprise.sqlite');
});

afterEach(async () => {
  resetAnalysisRunStoreForTests();
  restoreEnvValue(ENTERPRISE_DB_PATH_ENV, originalDbPath);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('analysis run store', () => {
  it('persists run lifecycle and heartbeat with workspace scope', () => {
    const runScope = scope();

    persistAnalysisRunState(runScope, 'running', { now: 1_777_000_000_000 });
    heartbeatAnalysisRun(runScope, 1_777_000_030_000);

    expect(getAnalysisRunLifecycle(runScope, 'run-a')).toEqual(expect.objectContaining({
      id: 'run-a',
      status: 'running',
      heartbeatAt: 1_777_000_030_000,
      updatedAt: 1_777_000_030_000,
      completedAt: null,
    }));
    expect(isAnalysisRunHeartbeatFresh(runScope, 'run-a', 1_777_000_040_000, 60_000)).toBe(true);
    expect(isAnalysisRunHeartbeatFresh(runScope, 'run-a', 1_777_000_200_000, 60_000)).toBe(false);
    expect(getAnalysisRunLifecycle(scope({ workspaceId: 'workspace-b' }), 'run-a')).toBeNull();

    const db = openEnterpriseDb();
    try {
      expect(db.prepare('SELECT status, heartbeat_at, updated_at FROM analysis_runs WHERE id = ?').get('run-a')).toEqual({
        status: 'running',
        heartbeat_at: 1_777_000_030_000,
        updated_at: 1_777_000_030_000,
      });
    } finally {
      db.close();
    }
  });

  it('marks terminal runs stale for cleanup decisions', () => {
    const runScope = scope({ runId: 'run-failed' });

    persistAnalysisRunState(runScope, 'running', { now: 1_777_000_000_000 });
    persistAnalysisRunState(runScope, 'failed', {
      now: 1_777_000_010_000,
      error: 'cancelled by user',
    });

    expect(getAnalysisRunLifecycle(runScope, 'run-failed')).toEqual(expect.objectContaining({
      status: 'failed',
      completedAt: 1_777_000_010_000,
      heartbeatAt: 1_777_000_010_000,
      errorJson: JSON.stringify({ message: 'cancelled by user' }),
    }));
    expect(isAnalysisRunHeartbeatFresh(runScope, 'run-failed', 1_777_000_011_000, 60_000)).toBe(false);
  });
});
