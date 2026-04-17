// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertValidSessionId,
  InvalidSessionIdError,
  sessionPaths,
} from '../paths';
import type { CliPaths } from '../paths';

describe('session id validation', () => {
  test('accepts our own agent-<timestamp>-<random> format', () => {
    expect(() => assertValidSessionId('agent-1776418311602-6eyc02fk')).not.toThrow();
  });

  test('accepts alphanumeric + hyphen + underscore', () => {
    expect(() => assertValidSessionId('a-b_c-123')).not.toThrow();
  });

  test('rejects empty string', () => {
    expect(() => assertValidSessionId('')).toThrow(InvalidSessionIdError);
  });

  test('rejects path traversal via ..', () => {
    expect(() => assertValidSessionId('..')).toThrow(InvalidSessionIdError);
    expect(() => assertValidSessionId('../foo')).toThrow(InvalidSessionIdError);
    expect(() => assertValidSessionId('../../etc/passwd')).toThrow(InvalidSessionIdError);
  });

  test('rejects absolute-path injection', () => {
    expect(() => assertValidSessionId('/tmp/foo')).toThrow(InvalidSessionIdError);
    expect(() => assertValidSessionId('/etc/shadow')).toThrow(InvalidSessionIdError);
  });

  test('rejects path separators', () => {
    expect(() => assertValidSessionId('foo/bar')).toThrow(InvalidSessionIdError);
    expect(() => assertValidSessionId('foo\\bar')).toThrow(InvalidSessionIdError);
  });

  test('rejects dots as leading char', () => {
    expect(() => assertValidSessionId('.hidden')).toThrow(InvalidSessionIdError);
  });

  test('rejects overly long ids', () => {
    expect(() => assertValidSessionId('a'.repeat(129))).toThrow(InvalidSessionIdError);
  });

  test('rejects non-string inputs', () => {
    expect(() => assertValidSessionId(undefined as unknown as string)).toThrow(InvalidSessionIdError);
    expect(() => assertValidSessionId(null as unknown as string)).toThrow(InvalidSessionIdError);
    expect(() => assertValidSessionId(123 as unknown as string)).toThrow(InvalidSessionIdError);
  });
});

describe('sessionPaths', () => {
  let tmpDir: string;
  let paths: CliPaths;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paths-test-'));
    paths = {
      home: tmpDir,
      sessionsRoot: path.join(tmpDir, 'sessions'),
      indexFile: path.join(tmpDir, 'index.json'),
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns path family for valid id', () => {
    const sp = sessionPaths(paths, 'agent-1-abc');
    expect(sp.dir).toBe(path.join(paths.sessionsRoot, 'agent-1-abc'));
    expect(sp.config).toBe(path.join(sp.dir, 'config.json'));
    expect(sp.report).toBe(path.join(sp.dir, 'report.html'));
    expect(sp.turnsDir).toBe(path.join(sp.dir, 'turns'));
  });

  test('throws on traversal attempt', () => {
    expect(() => sessionPaths(paths, '..')).toThrow(InvalidSessionIdError);
    expect(() => sessionPaths(paths, 'foo/../bar')).toThrow(InvalidSessionIdError);
  });

  test('all returned paths live under sessionsRoot', () => {
    const sp = sessionPaths(paths, 'agent-1-abc');
    const root = path.resolve(paths.sessionsRoot);
    for (const p of [sp.dir, sp.config, sp.conclusion, sp.transcript, sp.stream, sp.report, sp.turnsDir]) {
      expect(path.resolve(p).startsWith(root)).toBe(true);
    }
  });
});
