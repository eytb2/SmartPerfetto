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
  listSerializedAgentEventsAfter,
  persistSerializedAgentEvent,
  resetAgentEventStoreForTests,
  type AgentEventPersistenceScope,
} from '../agentEventStore';

const originalDbPath = process.env[ENTERPRISE_DB_PATH_ENV];

let tmpDir: string;

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function scope(overrides: Partial<AgentEventPersistenceScope> = {}): AgentEventPersistenceScope {
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-agent-events-'));
  process.env[ENTERPRISE_DB_PATH_ENV] = path.join(tmpDir, 'enterprise.sqlite');
});

afterEach(async () => {
  resetAgentEventStoreForTests();
  restoreEnvValue(ENTERPRISE_DB_PATH_ENV, originalDbPath);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('agent event store', () => {
  it('persists replayable SSE events with workspace scope and terminal run status', () => {
    const eventScope = scope();

    persistSerializedAgentEvent(eventScope, {
      cursor: 1,
      eventType: 'progress',
      eventData: JSON.stringify({ type: 'progress', data: { phase: 'start' } }),
      createdAt: 1_777_000_000_000,
    });
    persistSerializedAgentEvent(eventScope, {
      cursor: 2,
      eventType: 'analysis_completed',
      eventData: JSON.stringify({ type: 'analysis_completed', data: { reportUrl: '/api/reports/report-a' } }),
      createdAt: 1_777_000_000_100,
    });
    persistSerializedAgentEvent(eventScope, {
      cursor: 2,
      eventType: 'analysis_completed',
      eventData: JSON.stringify({ duplicate: true }),
      createdAt: 1_777_000_000_200,
    });

    expect(listSerializedAgentEventsAfter(eventScope, 'run-a', 0)).toEqual([
      expect.objectContaining({ cursor: 1, eventType: 'progress' }),
      expect.objectContaining({ cursor: 2, eventType: 'analysis_completed' }),
    ]);
    expect(listSerializedAgentEventsAfter(eventScope, 'run-a', 1)).toEqual([
      expect.objectContaining({
        cursor: 2,
        eventData: expect.stringContaining('/api/reports/report-a'),
      }),
    ]);
    expect(listSerializedAgentEventsAfter(scope({ workspaceId: 'workspace-b' }), 'run-a', 0)).toEqual([]);

    const db = openEnterpriseDb();
    try {
      expect(db.prepare('SELECT COUNT(*) AS count FROM agent_events WHERE run_id = ?').get('run-a')).toEqual({ count: 2 });
      expect(db.prepare('SELECT status, completed_at FROM analysis_runs WHERE id = ?').get('run-a')).toEqual({
        status: 'completed',
        completed_at: 1_777_000_000_100,
      });
      expect(db.prepare('SELECT status FROM analysis_sessions WHERE id = ?').get('session-a')).toEqual({
        status: 'completed',
      });
    } finally {
      db.close();
    }
  });

  it('marks the run failed when an error event is persisted', () => {
    persistSerializedAgentEvent(scope({ runId: 'run-failed' }), {
      cursor: 1,
      eventType: 'error',
      eventData: JSON.stringify({ error: 'cancelled' }),
      createdAt: 1_777_000_001_000,
    });

    const db = openEnterpriseDb();
    try {
      expect(db.prepare('SELECT status, completed_at FROM analysis_runs WHERE id = ?').get('run-failed')).toEqual({
        status: 'failed',
        completed_at: 1_777_000_001_000,
      });
    } finally {
      db.close();
    }
  });
});
