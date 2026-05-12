// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ENTERPRISE_FEATURE_FLAG_ENV } from '../../config';
import { ENTERPRISE_DB_PATH_ENV, openEnterpriseDb } from '../../services/enterpriseDb';
import { saveClaudeSessionMapToRuntimeSnapshots } from '../../services/runtimeSnapshotStore';
import { ClaudeRuntime, __testing } from '../claudeRuntime';

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
  it('recognizes missing SDK conversations from object-shaped result errors', () => {
    const message = __testing.getSdkResultErrorMessage({
      type: 'result',
      subtype: 'error_during_execution',
      errors: [{ message: 'No conversation found with session ID: sdk-session-a' }],
    });

    expect(message).toBe('Claude analysis error (error_during_execution): No conversation found with session ID: sdk-session-a');
    expect(__testing.isMissingSdkConversationError(message!)).toBe(true);
  });

  it('loads SDK session mappings from runtime_snapshots on construction', () => {
    const now = Date.now();
    saveClaudeSessionMapToRuntimeSnapshots({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      sessionId: 'session-a',
      runId: 'run-a',
      traceId: 'trace-a',
    }, 'session-a', {
      sdkSessionId: 'sdk-session-a',
      updatedAt: now,
    });

    const runtime = new ClaudeRuntime({} as any, {
      enableVerification: false,
      enableSubAgents: false,
    });

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      expect(runtime.getSdkSessionId('session-a')).toBe('sdk-session-a');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('does not expose stale SDK session mappings for persistence', () => {
    const now = 1_700_000_000_000;
    saveClaudeSessionMapToRuntimeSnapshots({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      sessionId: 'session-a',
      runId: 'run-a',
      traceId: 'trace-a',
    }, 'session-a', {
      sdkSessionId: 'sdk-session-a',
      updatedAt: now - (5 * 60 * 60 * 1000),
    });

    const runtime = new ClaudeRuntime({} as any, {
      enableVerification: false,
      enableSubAgents: false,
    });

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      expect(runtime.getSdkSessionId('session-a')).toBeUndefined();
    } finally {
      nowSpy.mockRestore();
    }
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

  it('forgets stale SDK mappings when the remote conversation is gone', () => {
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
    saveClaudeSessionMapToRuntimeSnapshots({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      sessionId: 'session-a',
      runId: 'run-a',
      traceId: 'trace-a',
    }, 'session-a:ref:trace-b', {
      sdkSessionId: 'sdk-session-b',
      updatedAt: Date.now(),
    });
    expect(runtimeSnapshotCount()).toBe(2);

    const runtime = new ClaudeRuntime({} as any, {
      enableVerification: false,
      enableSubAgents: false,
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      (runtime as any).forgetSdkSessionMapping(
        'session-a',
        'session-a',
        'Claude analysis error (error_during_execution): No conversation found with session ID: sdk-session-a',
      );
    } finally {
      warnSpy.mockRestore();
    }

    expect(runtime.getSdkSessionId('session-a')).toBeUndefined();
    expect(runtimeSnapshotCount()).toBe(1);
  });

  it('restores snapshot SDK mappings with the snapshot timestamp', () => {
    const runtime = new ClaudeRuntime({} as any, {
      enableVerification: false,
      enableSubAgents: false,
    });
    const snapshotTimestamp = Date.now() - (5 * 60 * 60 * 1000);

    runtime.restoreFromSnapshot('session-a', 'trace-a', {
      version: 1,
      snapshotTimestamp,
      sessionId: 'session-a',
      traceId: 'trace-a',
      conversationSteps: [],
      queryHistory: [],
      conclusionHistory: [],
      agentDialogue: [],
      agentResponses: [],
      dataEnvelopes: [],
      hypotheses: [],
      analysisNotes: [],
      analysisPlan: null,
      planHistory: [],
      uncertaintyFlags: [],
      sdkSessionId: 'sdk-session-a',
      runSequence: 0,
      conversationOrdinal: 0,
    });

    expect((runtime as any).sessionMap.get('session-a')).toEqual(expect.objectContaining({
      sdkSessionId: 'sdk-session-a',
      updatedAt: snapshotTimestamp,
    }));
  });

  it('does not persist stale SDK session mappings into snapshots', () => {
    const now = 1_700_000_000_000;
    const runtime = new ClaudeRuntime({} as any, {
      enableVerification: false,
      enableSubAgents: false,
    });
    (runtime as any).sessionMap.set('session-a', {
      sdkSessionId: 'sdk-session-stale',
      updatedAt: now - (5 * 60 * 60 * 1000),
    });

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const snapshot = runtime.takeSnapshot('session-a', 'trace-a', {
        conversationSteps: [],
        queryHistory: [],
        conclusionHistory: [],
        agentDialogue: [],
        agentResponses: [],
        dataEnvelopes: [],
        hypotheses: [],
        runSequence: 0,
        conversationOrdinal: 0,
      });

      expect(snapshot.sdkSessionId).toBeUndefined();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('persists fresh SDK session mappings into snapshots', () => {
    const now = 1_700_000_000_000;
    const runtime = new ClaudeRuntime({} as any, {
      enableVerification: false,
      enableSubAgents: false,
    });
    (runtime as any).sessionMap.set('session-a', {
      sdkSessionId: 'sdk-session-fresh',
      updatedAt: now - (30 * 60 * 1000),
    });

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const snapshot = runtime.takeSnapshot('session-a', 'trace-a', {
        conversationSteps: [],
        queryHistory: [],
        conclusionHistory: [],
        agentDialogue: [],
        agentResponses: [],
        dataEnvelopes: [],
        hypotheses: [],
        runSequence: 0,
        conversationOrdinal: 0,
      });

      expect(snapshot.sdkSessionId).toBe('sdk-session-fresh');
    } finally {
      nowSpy.mockRestore();
    }
  });
});
