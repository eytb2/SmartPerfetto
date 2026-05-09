// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as path from 'path';
// Use require so jest.spyOn can rebind these properties — `import * as fs`
// produces a frozen module namespace in some TS-Jest configs.
const fs: typeof import('fs') = require('fs');
import {
  createQuickConfig,
  explainClaudeRuntimeError,
  getClaudeRuntimeDiagnostics,
  getClaudeSdkBinaryDiagnostics,
  getSdkBinaryOption,
  loadClaudeConfig,
  resetSdkBinaryOptionCache,
} from '../claudeConfig';

const ORIGINAL_QUICK_MAX_TURNS = process.env.CLAUDE_QUICK_MAX_TURNS;
const ORIGINAL_ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ORIGINAL_ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;
const ORIGINAL_CLAUDE_MODEL = process.env.CLAUDE_MODEL;
const ORIGINAL_CLAUDE_LIGHT_MODEL = process.env.CLAUDE_LIGHT_MODEL;
const ORIGINAL_CLAUDE_CODE_USE_BEDROCK = process.env.CLAUDE_CODE_USE_BEDROCK;

afterEach(() => {
  if (ORIGINAL_QUICK_MAX_TURNS === undefined) {
    delete process.env.CLAUDE_QUICK_MAX_TURNS;
  } else {
    process.env.CLAUDE_QUICK_MAX_TURNS = ORIGINAL_QUICK_MAX_TURNS;
  }
  if (ORIGINAL_ANTHROPIC_BASE_URL === undefined) {
    delete process.env.ANTHROPIC_BASE_URL;
  } else {
    process.env.ANTHROPIC_BASE_URL = ORIGINAL_ANTHROPIC_BASE_URL;
  }
  if (ORIGINAL_ANTHROPIC_API_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY;
  }
  if (ORIGINAL_ANTHROPIC_AUTH_TOKEN === undefined) {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  } else {
    process.env.ANTHROPIC_AUTH_TOKEN = ORIGINAL_ANTHROPIC_AUTH_TOKEN;
  }
  if (ORIGINAL_CLAUDE_MODEL === undefined) {
    delete process.env.CLAUDE_MODEL;
  } else {
    process.env.CLAUDE_MODEL = ORIGINAL_CLAUDE_MODEL;
  }
  if (ORIGINAL_CLAUDE_LIGHT_MODEL === undefined) {
    delete process.env.CLAUDE_LIGHT_MODEL;
  } else {
    process.env.CLAUDE_LIGHT_MODEL = ORIGINAL_CLAUDE_LIGHT_MODEL;
  }
  if (ORIGINAL_CLAUDE_CODE_USE_BEDROCK === undefined) {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
  } else {
    process.env.CLAUDE_CODE_USE_BEDROCK = ORIGINAL_CLAUDE_CODE_USE_BEDROCK;
  }
});

describe('createQuickConfig', () => {
  it('keeps the existing quick max-turn default', () => {
    delete process.env.CLAUDE_QUICK_MAX_TURNS;
    const config = createQuickConfig(loadClaudeConfig({ maxTurns: 60 }));

    expect(config.maxTurns).toBe(10);
    expect(config.enableVerification).toBe(false);
    expect(config.enableSubAgents).toBe(false);
  });

  it('allows quick max-turn override via env', () => {
    process.env.CLAUDE_QUICK_MAX_TURNS = '8';
    const config = createQuickConfig(loadClaudeConfig({ maxTurns: 60 }));

    expect(config.maxTurns).toBe(8);
  });

  it('ignores invalid quick max-turn env values', () => {
    process.env.CLAUDE_QUICK_MAX_TURNS = '0';
    const config = createQuickConfig(loadClaudeConfig({ maxTurns: 60 }));

    expect(config.maxTurns).toBe(10);
  });
});

describe('getClaudeRuntimeDiagnostics', () => {
  it('reports Anthropic-compatible proxy mode', () => {
    process.env.ANTHROPIC_BASE_URL = 'http://localhost:3000';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.CLAUDE_MODEL = 'mimo-main';
    process.env.CLAUDE_LIGHT_MODEL = 'mimo-light';

    const diagnostics = getClaudeRuntimeDiagnostics();

    expect(diagnostics.runtime).toBe('claude-agent-sdk');
    expect(diagnostics.providerMode).toBe('anthropic_compatible_proxy');
    expect(diagnostics.model).toBe('mimo-main');
    expect(diagnostics.lightModel).toBe('mimo-light');
    expect(diagnostics.configured).toBe(true);
    expect(diagnostics.credentialSources).toContain('anthropic_compatible_proxy');
  });

  it('treats ANTHROPIC_AUTH_TOKEN as a configured credential source', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
    delete process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_AUTH_TOKEN = 'sk-deepseek-test';

    const diagnostics = getClaudeRuntimeDiagnostics();

    expect(diagnostics.providerMode).toBe('anthropic_compatible_proxy');
    expect(diagnostics.configured).toBe(true);
    expect(diagnostics.credentialSources).toContain('anthropic_auth_token');
  });

  it('reports unconfigured mode when no credential source is set', () => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.CLAUDE_CODE_USE_BEDROCK;

    const diagnostics = getClaudeRuntimeDiagnostics();

    expect(diagnostics.providerMode).toBe('unconfigured');
    expect(diagnostics.configured).toBe(false);
  });
});

describe('explainClaudeRuntimeError', () => {
  it('adds provider guidance for quota/auth failures', () => {
    const message = explainClaudeRuntimeError("You're out of extra usage");

    expect(message).toContain("You're out of extra usage");
    expect(message).toContain('ANTHROPIC_BASE_URL');
    expect(message).toContain('CC Switch');
  });

  it('leaves unrelated errors unchanged', () => {
    const message = 'trace processor failed';

    expect(explainClaudeRuntimeError(message)).toBe(message);
  });

  it('detects SDK native-binary-missing errors and points at CLAUDE_BINARY_PATH (zh-CN)', () => {
    const sdkError = 'Claude Code native binary not found at /app/backend/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude. Please ensure Claude Code is installed via native installer or specify a valid path with options.pathToClaudeCodeExecutable.';
    const explained = explainClaudeRuntimeError(sdkError, 'zh-CN');

    expect(explained).toContain(sdkError);
    expect(explained).toContain('CLAUDE_BINARY_PATH');
    expect(explained).toContain('docker exec');
    expect(explained).toContain('原生二进制');
    // Must NOT be misclassified as a quota/auth issue
    expect(explained).not.toContain('CC Switch');
  });

  it('detects SDK native-binary-missing errors in English mode', () => {
    const sdkError = 'Claude Code native binary not found at /app/backend/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude.';
    const explained = explainClaudeRuntimeError(sdkError, 'en');

    expect(explained).toContain('CLAUDE_BINARY_PATH');
    expect(explained).toContain('platform detection failed');
    expect(explained).not.toContain('CC Switch');
  });
});

describe('getSdkBinaryOption — auto fallback', () => {
  let accessSyncSpy: jest.SpiedFunction<typeof fs.accessSync>;
  let readdirSyncSpy: jest.SpiedFunction<typeof fs.readdirSync>;
  let originalReport: NodeJS.Process['report'];
  const ORIGINAL_BINARY_PATH = process.env.CLAUDE_BINARY_PATH;

  beforeEach(() => {
    resetSdkBinaryOptionCache();
    delete process.env.CLAUDE_BINARY_PATH;
    accessSyncSpy = jest.spyOn(fs, 'accessSync');
    readdirSyncSpy = jest.spyOn(fs, 'readdirSync');
    originalReport = process.report;
  });

  afterEach(() => {
    accessSyncSpy.mockRestore();
    readdirSyncSpy.mockRestore();
    Object.defineProperty(process, 'report', { value: originalReport, configurable: true });
    if (ORIGINAL_BINARY_PATH === undefined) {
      delete process.env.CLAUDE_BINARY_PATH;
    } else {
      process.env.CLAUDE_BINARY_PATH = ORIGINAL_BINARY_PATH;
    }
    resetSdkBinaryOptionCache();
  });

  function mockGlibcReport(glibcVersion: string | undefined): void {
    Object.defineProperty(process, 'report', {
      value: { getReport: () => ({ header: { glibcVersionRuntime: glibcVersion } }) },
      configurable: true,
    });
  }

  function expectedAnthropicDir(): string {
    const sdkMain = require.resolve('@anthropic-ai/claude-agent-sdk');
    return path.resolve(path.dirname(sdkMain), '..');
  }

  /** accessSync mock that throws ENOENT for any path NOT in the allowlist. */
  function mockBinariesPresent(...allowedPaths: string[]): void {
    accessSyncSpy.mockImplementation((p) => {
      if (!allowedPaths.includes(String(p))) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
    });
  }

  it('explicit CLAUDE_BINARY_PATH wins and bypasses fs probing', () => {
    process.env.CLAUDE_BINARY_PATH = '/custom/claude';
    const opt = getSdkBinaryOption();

    expect(opt).toEqual({ pathToClaudeCodeExecutable: '/custom/claude' });
    expect(accessSyncSpy).not.toHaveBeenCalled();
    expect(getClaudeSdkBinaryDiagnostics().source).toBe('env-override');
  });

  it('explicit override reads from passed env, not just process.env', () => {
    delete process.env.CLAUDE_BINARY_PATH;
    const opt = getSdkBinaryOption({ CLAUDE_BINARY_PATH: '/passed/claude' });
    expect(opt).toEqual({ pathToClaudeCodeExecutable: '/passed/claude' });
  });

  it('picks SDK default variant when its binary exists', () => {
    if (process.platform !== 'linux') return; // linux-only branch
    mockGlibcReport('2.36');
    const dir = expectedAnthropicDir();
    const expected = path.join(dir, `claude-agent-sdk-linux-${process.arch}`, 'claude');
    mockBinariesPresent(expected);

    const opt = getSdkBinaryOption();
    expect(opt.pathToClaudeCodeExecutable).toBe(expected);

    const diag = getClaudeSdkBinaryDiagnostics();
    expect(diag.source).toBe('sdk-default');
    expect(diag.fallbackUsed).toBe(false);
    expect(diag.detectedPlatformKey).toBe(`linux-${process.arch}`);
  });

  it('falls back to a sibling variant when SDK default is missing', () => {
    if (process.platform !== 'linux') return; // linux-only branch
    mockGlibcReport(undefined); // SDK would pick -musl
    const dir = expectedAnthropicDir();
    const muslPath = path.join(dir, `claude-agent-sdk-linux-${process.arch}-musl`, 'claude');
    const glibcPath = path.join(dir, `claude-agent-sdk-linux-${process.arch}`, 'claude');

    mockBinariesPresent(glibcPath);
    readdirSyncSpy.mockReturnValue([
      { name: `claude-agent-sdk-linux-${process.arch}`, isDirectory: () => true },
      { name: `claude-agent-sdk-linux-${process.arch}-musl`, isDirectory: () => true },
      { name: 'claude-agent-sdk', isDirectory: () => true },
    ] as unknown as never);

    const opt = getSdkBinaryOption();
    expect(opt.pathToClaudeCodeExecutable).toBe(glibcPath);
    expect(opt.pathToClaudeCodeExecutable).not.toBe(muslPath);

    const diag = getClaudeSdkBinaryDiagnostics();
    expect(diag.source).toBe('fallback');
    expect(diag.fallbackUsed).toBe(true);
  });

  it('returns {} and reports source=none when nothing is found', () => {
    if (process.platform !== 'linux') return; // linux-only branch
    mockGlibcReport('2.36');
    mockBinariesPresent(); // nothing exists
    readdirSyncSpy.mockReturnValue([] as unknown as never);

    expect(getSdkBinaryOption()).toEqual({});
    expect(getClaudeSdkBinaryDiagnostics().source).toBe('none');
  });

  it('memoizes auto-detection across calls', () => {
    if (process.platform !== 'linux') return; // linux-only branch
    mockGlibcReport('2.36');
    const dir = expectedAnthropicDir();
    const expected = path.join(dir, `claude-agent-sdk-linux-${process.arch}`, 'claude');
    mockBinariesPresent(expected);

    getSdkBinaryOption();
    const callsAfterFirst = accessSyncSpy.mock.calls.length;
    getSdkBinaryOption();
    getSdkBinaryOption();
    expect(accessSyncSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('skips process.report.getReport on env-override (hot health-poll path)', () => {
    process.env.CLAUDE_BINARY_PATH = '/custom/claude';
    const reportSpy = jest.fn(() => ({ header: { glibcVersionRuntime: '2.36' } }));
    Object.defineProperty(process, 'report', {
      value: { getReport: reportSpy },
      configurable: true,
    });

    getClaudeSdkBinaryDiagnostics();
    getClaudeSdkBinaryDiagnostics();
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it('swallows probe errors and returns {} (never crashes the runtime)', () => {
    accessSyncSpy.mockImplementation(() => { throw new Error('EACCES'); });
    readdirSyncSpy.mockImplementation(() => { throw new Error('EACCES'); });

    expect(() => getSdkBinaryOption()).not.toThrow();
    expect(getSdkBinaryOption()).toEqual({});
  });
});
