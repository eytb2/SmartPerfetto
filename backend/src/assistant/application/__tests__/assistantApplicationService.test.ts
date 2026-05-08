// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { describe, expect, it, jest } from '@jest/globals';
import {
  AssistantApplicationService,
  type ManagedAssistantSession,
} from '../assistantApplicationService';

function session(overrides: Partial<ManagedAssistantSession> = {}): ManagedAssistantSession {
  return {
    sessionId: 'session-a',
    status: 'running',
    createdAt: 1_777_000_000_000,
    lastActivityAt: 1_777_000_000_000,
    sseClients: [],
    ...overrides,
  };
}

describe('AssistantApplicationService cleanup', () => {
  it('lets callers keep abandoned non-terminal sessions when an external run heartbeat is fresh', () => {
    const service = new AssistantApplicationService<ManagedAssistantSession>();
    const managed = session();
    const onCleanup = jest.fn();
    service.setSession(managed.sessionId, managed);

    const removed = service.cleanupIdleSessions({
      now: 1_777_000_010_000,
      terminalMaxIdleMs: 1_000,
      nonTerminalMaxIdleMs: 1_000,
      shouldCleanup: (_sessionId, _session, context) => {
        expect(context.isAbandonedNonTerminal).toBe(true);
        return false;
      },
      onCleanup,
    });

    expect(removed).toEqual([]);
    expect(onCleanup).not.toHaveBeenCalled();
    expect(service.getSession(managed.sessionId)).toBe(managed);
  });

  it('still removes stale abandoned non-terminal sessions when the cleanup predicate allows it', () => {
    const service = new AssistantApplicationService<ManagedAssistantSession>();
    const managed = session();
    service.setSession(managed.sessionId, managed);

    const removed = service.cleanupIdleSessions({
      now: 1_777_000_010_000,
      terminalMaxIdleMs: 1_000,
      nonTerminalMaxIdleMs: 1_000,
      shouldCleanup: () => true,
    });

    expect(removed).toEqual([managed.sessionId]);
    expect(service.getSession(managed.sessionId)).toBeUndefined();
  });
});
