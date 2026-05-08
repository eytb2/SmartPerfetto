// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import path from 'path';
import {
  buildLoadTestReport,
  buildMarkdownLoadTestReport,
  evaluateAcceptance,
  parseLoadTestArgs,
  percentile,
  summarizeLoadTest,
  type AnalysisStatusSnapshot,
  type EnterpriseLoadTestOptions,
  type HttpSample,
  type RuntimeSample,
} from '../enterpriseAcceptanceLoadTest';

function options(overrides: Partial<EnterpriseLoadTestOptions> = {}): EnterpriseLoadTestOptions {
  return {
    baseUrl: 'http://localhost:3000',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    onlineUsers: 50,
    targetRunningRuns: 10,
    targetPendingRuns: 5,
    maxErrorRate: 0.01,
    durationMs: 60_000,
    pollIntervalMs: 1000,
    traceIds: ['trace-a'],
    query: 'load test',
    outputPath: '/tmp/load-test.json',
    ...overrides,
  };
}

function sample(operation: string, durationMs: number, ok = true, userId = 'user-a'): HttpSample {
  return {
    operation,
    userId,
    status: ok ? 200 : 500,
    ok,
    durationMs,
    timestamp: '2026-05-09T00:00:00.000Z',
  };
}

function onlineUserSamples(count: number): HttpSample[] {
  return Array.from({ length: count }, (_unused, index) =>
    sample('trace_list', 10, true, `online-user-${String(index + 1).padStart(3, '0')}`)
  );
}

function runtimeSample(overrides: Partial<RuntimeSample> = {}): RuntimeSample {
  return {
    timestamp: '2026-05-09T00:00:01.000Z',
    queueLength: 1,
    workerRssBytes: 256,
    leaseRssBytes: null,
    llmCostUsd: 0.1,
    llmCalls: 1,
    ...overrides,
  };
}

function passingRuntimeSamples(): RuntimeSample[] {
  return [
    runtimeSample({ timestamp: '2026-05-09T00:00:00.000Z', llmCalls: 0 }),
    runtimeSample({ timestamp: '2026-05-09T00:00:01.000Z', llmCalls: 1 }),
  ];
}

describe('enterprise acceptance load test helpers', () => {
  it('parses repeatable trace ids and report paths', () => {
    const cwd = '/tmp/smartperfetto';
    const parsed = parseLoadTestArgs([
      '--base-url', 'http://127.0.0.1:3000/',
      '--tenant-id', 'tenant-z',
      '--workspace-id', 'workspace-z',
      '--users', '55',
      '--target-running', '12',
      '--target-pending', '7',
      '--max-error-rate', '0.02',
      '--duration-ms', '120000',
      '--poll-interval-ms', '2000',
      '--trace-id', 'trace-a',
      '--trace-id', 'trace-b',
      '--query', '验收压测',
      '--output', 'out/load.json',
      '--markdown', 'out/load.md',
    ], cwd);

    expect(parsed).toEqual(expect.objectContaining({
      baseUrl: 'http://127.0.0.1:3000',
      tenantId: 'tenant-z',
      workspaceId: 'workspace-z',
      onlineUsers: 55,
      targetRunningRuns: 12,
      targetPendingRuns: 7,
      maxErrorRate: 0.02,
      durationMs: 120000,
      pollIntervalMs: 2000,
      traceIds: ['trace-a', 'trace-b'],
      query: '验收压测',
      outputPath: path.resolve(cwd, 'out/load.json'),
      markdownPath: path.resolve(cwd, 'out/load.md'),
    }));
  });

  it('computes nearest-rank percentiles', () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([10], 0.95)).toBe(10);
    expect(percentile([100, 10, 30, 20], 0.5)).toBe(20);
    expect(percentile([100, 10, 30, 20], 0.95)).toBe(100);
  });

  it('summarizes latency, error rate, run counts, queue, RSS, and LLM cost', () => {
    const statusSnapshots: AnalysisStatusSnapshot[] = [
      {
        timestamp: '2026-05-09T00:00:01.000Z',
        counts: {
          queued: 2,
          pending: 3,
          running: 8,
          completed: 0,
          failed: 0,
          error: 0,
          quota_exceeded: 0,
          unknown: 0,
        },
      },
      {
        timestamp: '2026-05-09T00:00:02.000Z',
        counts: {
          queued: 1,
          pending: 2,
          running: 10,
          completed: 2,
          failed: 0,
          error: 0,
          quota_exceeded: 0,
          unknown: 0,
        },
      },
    ];
    const runtimeSamples: RuntimeSample[] = [
      {
        timestamp: '2026-05-09T00:00:01.000Z',
        queueLength: 4,
        workerRssBytes: 100,
        leaseRssBytes: 200,
        llmCostUsd: 0.1,
        llmCalls: 1,
      },
      {
        timestamp: '2026-05-09T00:00:02.000Z',
        queueLength: 9,
        workerRssBytes: 300,
        leaseRssBytes: 250,
        llmCostUsd: 0.4,
        llmCalls: 3,
      },
    ];

    const summary = summarizeLoadTest({
      options: options(),
      httpSamples: [
        sample('trace_list', 10),
        sample('trace_list', 20),
        sample('analyze_start', 100),
        sample('analysis_status', 50),
        sample('runtime_dashboard', 80, false),
      ],
      runs: [
        { userId: 'user-a', traceId: 'trace-a', startStatus: 200, startOk: true, lastStatus: 'completed' },
        { userId: 'user-b', traceId: 'trace-a', startStatus: 500, startOk: false, lastStatus: 'error' },
      ],
      statusSnapshots,
      runtimeSamples,
    });

    expect(summary.errorRate).toBe(0.2);
    expect(summary.onlineUsers).toEqual({
      configured: 50,
      observed: 0,
    });
    expect(summary.latency.overall.p50Ms).toBe(50);
    expect(summary.latency.overall.p95Ms).toBe(100);
    expect(summary.latency.byOperation.trace_list.p95Ms).toBe(20);
    expect(summary.analysis).toEqual(expect.objectContaining({
      started: 1,
      startFailures: 1,
      maxRunning: 10,
      maxPending: 5,
      runningInRangeSnapshots: 2,
      pendingSnapshots: 2,
    }));
    expect(summary.runtime).toEqual(expect.objectContaining({
      maxQueueLength: 9,
      maxWorkerRssBytes: 300,
      maxLeaseRssBytes: 250,
      initialLlmCostUsd: 0.1,
      finalLlmCostUsd: 0.4,
      initialLlmCalls: 1,
      finalLlmCalls: 3,
      llmCallDelta: 2,
    }));
    expect(summary.runtime.llmCostDeltaUsd).toBeCloseTo(0.3);
  });

  it('requires direct load metrics before acceptance can pass', () => {
    const opts = options({ onlineUsers: 49 });
    const summary = summarizeLoadTest({
      options: opts,
      httpSamples: [sample('trace_list', 10)],
      runs: [],
      statusSnapshots: [],
      runtimeSamples: [],
    });

    expect(evaluateAcceptance(opts, summary, [])).toEqual({
      passed: false,
      missing: expect.arrayContaining([
        'onlineUsers < 50',
        'observed online users < 50',
        'started analysis runs < requested target',
        'observed max running runs < 5',
        'no queued/pending runs observed',
        'missing worker/lease RSS samples',
        'missing queue length samples',
        'missing LLM cost sample',
        'missing LLM call sample',
        'runtime dashboard was not sampled',
      ]),
    });
  });

  it('requires successful samples from 50 distinct online users', () => {
    const opts = options({ onlineUsers: 50, maxErrorRate: 0.05 });
    const runtimeSamples = passingRuntimeSamples();
    const summary = summarizeLoadTest({
      options: opts,
      httpSamples: [
        ...onlineUserSamples(49),
        sample('trace_list', 10, false, 'online-user-050'),
      ],
      runs: Array.from({ length: 15 }, (_unused, index) => ({
        userId: `load-user-${String(index + 1).padStart(3, '0')}`,
        traceId: 'trace-a',
        startStatus: 200,
        startOk: true,
        lastStatus: 'running' as const,
      })),
      statusSnapshots: [
        {
          timestamp: '2026-05-09T00:00:01.000Z',
          counts: {
            queued: 1,
            pending: 1,
            running: 5,
            completed: 0,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
        {
          timestamp: '2026-05-09T00:00:02.000Z',
          counts: {
            queued: 0,
            pending: 1,
            running: 5,
            completed: 1,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
      ],
      runtimeSamples,
    });

    expect(summary.onlineUsers.observed).toBe(49);
    expect(evaluateAcceptance(opts, summary, runtimeSamples)).toEqual({
      passed: false,
      missing: ['observed online users < 50'],
    });
  });

  it('requires running and pending state to be stable across multiple samples', () => {
    const opts = options({ onlineUsers: 50 });
    const runtimeSamples = passingRuntimeSamples();
    const summary = summarizeLoadTest({
      options: opts,
      httpSamples: onlineUserSamples(50),
      runs: Array.from({ length: 15 }, (_unused, index) => ({
        userId: `load-user-${String(index + 1).padStart(3, '0')}`,
        traceId: 'trace-a',
        startStatus: 200,
        startOk: true,
        lastStatus: 'running' as const,
      })),
      statusSnapshots: [
        {
          timestamp: '2026-05-09T00:00:01.000Z',
          counts: {
            queued: 1,
            pending: 1,
            running: 5,
            completed: 0,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
      ],
      runtimeSamples,
    });

    expect(summary.analysis).toEqual(expect.objectContaining({
      maxRunning: 5,
      maxPending: 2,
      runningInRangeSnapshots: 1,
      pendingSnapshots: 1,
    }));
    expect(evaluateAcceptance(opts, summary, runtimeSamples)).toEqual({
      passed: false,
      missing: [
        'running runs were not stable for at least 2 samples',
        'queued/pending runs were not stable for at least 2 samples',
      ],
    });
  });

  it('requires all requested analysis runs to start and LLM call metrics to be present', () => {
    const opts = options({ onlineUsers: 50 });
    const runtimeSamples = [
      runtimeSample({ timestamp: '2026-05-09T00:00:00.000Z', llmCalls: 0 }),
      runtimeSample({ timestamp: '2026-05-09T00:00:01.000Z', llmCalls: 0 }),
    ];
    const summary = summarizeLoadTest({
      options: opts,
      httpSamples: onlineUserSamples(50),
      runs: [
        ...Array.from({ length: 14 }, (_unused, index) => ({
          userId: `load-user-${String(index + 1).padStart(3, '0')}`,
          traceId: 'trace-a',
          startStatus: 200,
          startOk: true,
          lastStatus: 'running' as const,
        })),
        {
          userId: 'load-user-015',
          traceId: 'trace-a',
          startStatus: 500,
          startOk: false,
          lastStatus: 'error' as const,
        },
      ],
      statusSnapshots: [
        {
          timestamp: '2026-05-09T00:00:01.000Z',
          counts: {
            queued: 1,
            pending: 1,
            running: 5,
            completed: 0,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
        {
          timestamp: '2026-05-09T00:00:02.000Z',
          counts: {
            queued: 0,
            pending: 1,
            running: 5,
            completed: 1,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
      ],
      runtimeSamples,
    });

    expect(evaluateAcceptance(opts, summary, runtimeSamples)).toEqual({
      passed: false,
      missing: [
        'started analysis runs < requested target',
        'analysis start failures observed',
        'terminal analysis failures observed',
        'LLM call count did not increase',
      ],
    });
  });

  it('rejects terminal failed, error, or quota_exceeded analysis runs', () => {
    const opts = options({ onlineUsers: 50 });
    const runtimeSamples = passingRuntimeSamples();
    const summary = summarizeLoadTest({
      options: opts,
      httpSamples: onlineUserSamples(50),
      runs: [
        ...Array.from({ length: 12 }, (_unused, index) => ({
          userId: `load-user-${String(index + 1).padStart(3, '0')}`,
          traceId: 'trace-a',
          startStatus: 200,
          startOk: true,
          lastStatus: 'running' as const,
        })),
        {
          userId: 'load-user-013',
          traceId: 'trace-a',
          startStatus: 200,
          startOk: true,
          lastStatus: 'failed' as const,
        },
        {
          userId: 'load-user-014',
          traceId: 'trace-a',
          startStatus: 200,
          startOk: true,
          lastStatus: 'error' as const,
        },
        {
          userId: 'load-user-015',
          traceId: 'trace-a',
          startStatus: 200,
          startOk: true,
          lastStatus: 'quota_exceeded' as const,
        },
      ],
      statusSnapshots: [
        {
          timestamp: '2026-05-09T00:00:01.000Z',
          counts: {
            queued: 1,
            pending: 1,
            running: 5,
            completed: 0,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
        {
          timestamp: '2026-05-09T00:00:02.000Z',
          counts: {
            queued: 0,
            pending: 1,
            running: 5,
            completed: 1,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
      ],
      runtimeSamples,
    });

    expect(summary.analysis.terminal).toEqual({
      failed: 1,
      error: 1,
      quota_exceeded: 1,
    });
    expect(evaluateAcceptance(opts, summary, runtimeSamples)).toEqual({
      passed: false,
      missing: ['terminal analysis failures observed'],
    });
  });

  it('requires HTTP error rate to stay within the configured threshold', () => {
    const opts = options({ onlineUsers: 50, maxErrorRate: 0.01 });
    const runtimeSamples = passingRuntimeSamples();
    const summary = summarizeLoadTest({
      options: opts,
      httpSamples: [
        ...onlineUserSamples(50),
        sample('analysis_status', 30, false, 'load-user-001'),
      ],
      runs: Array.from({ length: 15 }, (_unused, index) => ({
        userId: `load-user-${String(index + 1).padStart(3, '0')}`,
        traceId: 'trace-a',
        startStatus: 200,
        startOk: true,
        lastStatus: 'running' as const,
      })),
      statusSnapshots: [
        {
          timestamp: '2026-05-09T00:00:01.000Z',
          counts: {
            queued: 1,
            pending: 1,
            running: 5,
            completed: 0,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
        {
          timestamp: '2026-05-09T00:00:02.000Z',
          counts: {
            queued: 0,
            pending: 1,
            running: 5,
            completed: 1,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
      ],
      runtimeSamples,
    });

    expect(evaluateAcceptance(opts, summary, runtimeSamples)).toEqual({
      passed: false,
      missing: ['error rate 1.96% exceeds max 1.00%'],
    });
  });

  it('requires LLM calls to increase during the load-test window', () => {
    const opts = options({ onlineUsers: 50 });
    const runtimeSamples = [
      runtimeSample({ timestamp: '2026-05-09T00:00:00.000Z', llmCalls: 7 }),
      runtimeSample({ timestamp: '2026-05-09T00:00:01.000Z', llmCalls: 7 }),
    ];
    const summary = summarizeLoadTest({
      options: opts,
      httpSamples: onlineUserSamples(50),
      runs: Array.from({ length: 15 }, (_unused, index) => ({
        userId: `load-user-${String(index + 1).padStart(3, '0')}`,
        traceId: 'trace-a',
        startStatus: 200,
        startOk: true,
        lastStatus: 'running' as const,
      })),
      statusSnapshots: [
        {
          timestamp: '2026-05-09T00:00:01.000Z',
          counts: {
            queued: 1,
            pending: 1,
            running: 5,
            completed: 0,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
        {
          timestamp: '2026-05-09T00:00:02.000Z',
          counts: {
            queued: 0,
            pending: 1,
            running: 5,
            completed: 1,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
      ],
      runtimeSamples,
    });

    expect(summary.runtime).toEqual(expect.objectContaining({
      initialLlmCalls: 7,
      finalLlmCalls: 7,
      llmCallDelta: 0,
    }));
    expect(evaluateAcceptance(opts, summary, runtimeSamples)).toEqual({
      passed: false,
      missing: ['LLM call count did not increase'],
    });
  });

  it('requires LLM cost delta to be measurable during the load-test window', () => {
    const opts = options({ onlineUsers: 50 });
    const runtimeSamples = [
      runtimeSample({ timestamp: '2026-05-09T00:00:00.000Z', llmCostUsd: 1.2, llmCalls: 7 }),
      runtimeSample({ timestamp: '2026-05-09T00:00:01.000Z', llmCostUsd: null, llmCalls: 8 }),
    ];
    const summary = summarizeLoadTest({
      options: opts,
      httpSamples: onlineUserSamples(50),
      runs: Array.from({ length: 15 }, (_unused, index) => ({
        userId: `load-user-${String(index + 1).padStart(3, '0')}`,
        traceId: 'trace-a',
        startStatus: 200,
        startOk: true,
        lastStatus: 'running' as const,
      })),
      statusSnapshots: [
        {
          timestamp: '2026-05-09T00:00:01.000Z',
          counts: {
            queued: 1,
            pending: 1,
            running: 5,
            completed: 0,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
        {
          timestamp: '2026-05-09T00:00:02.000Z',
          counts: {
            queued: 0,
            pending: 1,
            running: 5,
            completed: 1,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
      ],
      runtimeSamples,
    });

    expect(summary.runtime).toEqual(expect.objectContaining({
      initialLlmCostUsd: 1.2,
      finalLlmCostUsd: 1.2,
      llmCostDeltaUsd: null,
      initialLlmCalls: 7,
      finalLlmCalls: 8,
      llmCallDelta: 1,
    }));
    expect(evaluateAcceptance(opts, summary, runtimeSamples)).toEqual({
      passed: false,
      missing: ['missing LLM cost sample'],
    });
  });

  it('renders the required load-test report fields', () => {
    const opts = options();
    const report = buildLoadTestReport({
      options: opts,
      httpSamples: [...onlineUserSamples(50), sample('analyze_start', 30)],
      runs: [
        ...Array.from({ length: 15 }, (_unused, index) => ({
          userId: `load-user-${String(index + 1).padStart(3, '0')}`,
          traceId: 'trace-a',
          sessionId: `session-${index + 1}`,
          runId: `run-${index + 1}`,
          startStatus: 200,
          startOk: true,
          lastStatus: 'running',
        } as const)),
      ],
      statusSnapshots: [
        {
          timestamp: '2026-05-09T00:00:01.000Z',
          counts: {
            queued: 1,
            pending: 1,
            running: 5,
            completed: 0,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
        {
          timestamp: '2026-05-09T00:00:02.000Z',
          counts: {
            queued: 0,
            pending: 1,
            running: 5,
            completed: 1,
            failed: 0,
            error: 0,
            quota_exceeded: 0,
            unknown: 0,
          },
        },
      ],
      runtimeSamples: [
        runtimeSample({
          timestamp: '2026-05-09T00:00:00.000Z',
          queueLength: 1,
          workerRssBytes: 128 * 1024 * 1024,
          leaseRssBytes: 64 * 1024 * 1024,
          llmCostUsd: 0.75,
          llmCalls: 3,
        }),
        runtimeSample({
          timestamp: '2026-05-09T00:00:01.000Z',
          queueLength: 3,
          workerRssBytes: 256 * 1024 * 1024,
          leaseRssBytes: 128 * 1024 * 1024,
          llmCostUsd: 1.23,
          llmCalls: 4,
        }),
      ],
    });

    const markdown = buildMarkdownLoadTestReport(report);
    expect(markdown).toContain('Acceptance status: passed');
    expect(markdown).toContain('| Online users | 50 |');
    expect(markdown).toContain('| Observed online users | 50 |');
    expect(markdown).toContain('| Max error rate | 1.00% |');
    expect(markdown).toContain('| Overall p50 | 10ms |');
    expect(markdown).toContain('| Running-in-range samples | 2 |');
    expect(markdown).toContain('| Queued/pending samples | 2 |');
    expect(markdown).toContain('| Max worker RSS | 256.0 MiB |');
    expect(markdown).toContain('| Initial LLM cost | 0.75 |');
    expect(markdown).toContain('| Final LLM cost | 1.23 |');
    expect(markdown).toContain('| LLM cost delta | 0.48 |');
    expect(markdown).toContain('| Initial LLM calls | 3 |');
    expect(markdown).toContain('| Final LLM calls | 4 |');
    expect(markdown).toContain('| LLM call delta | 1 |');
  });
});
