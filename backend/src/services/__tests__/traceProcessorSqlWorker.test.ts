// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { afterEach, describe, expect, it } from '@jest/globals';
import {
  decodeQueryArgsSql,
  encodeQueryResult,
} from '../traceProcessorProtobuf';
import {
  normalizeTraceProcessorQueryPriority,
  TraceProcessorSqlWorker,
} from '../traceProcessorSqlWorker';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function encodedSqlResult(sql: string): Buffer {
  return encodeQueryResult({
    columnNames: ['sql'],
    rows: [[sql]],
  });
}

describe('TraceProcessorSqlWorker', () => {
  let worker: TraceProcessorSqlWorker | null = null;

  afterEach(() => {
    worker?.destroy();
    worker = null;
  });

  it('does not preempt the running query, but runs queued P0 before queued P1/P2', async () => {
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<Buffer>>>();

    worker = new TraceProcessorSqlWorker({
      processorId: 'processor-a',
      traceId: 'trace-a',
      port: 1,
      forceInline: true,
      rawExecutor: async request => {
        const sql = decodeQueryArgsSql(request.body);
        started.push(sql);
        const gate = gates.get(sql) || deferred<Buffer>();
        gates.set(sql, gate);
        return gate.promise;
      },
    });

    const p2 = worker.query('SELECT p2', { priority: 'p2' });
    await flushPromises();
    expect(started).toEqual(['SELECT p2']);

    const p1 = worker.query('SELECT p1', { priority: 'p1' });
    const p0 = worker.query('SELECT p0', { priority: 'p0' });
    await flushPromises();
    expect(started).toEqual(['SELECT p2']);
    expect(worker.getStats()).toMatchObject({
      running: true,
      queuedP0: 1,
      queuedP1: 1,
      queuedP2: 0,
    });

    gates.get('SELECT p2')!.resolve(encodedSqlResult('SELECT p2'));
    await expect(p2).resolves.toMatchObject({ rows: [['SELECT p2']] });
    await flushPromises();
    expect(started).toEqual(['SELECT p2', 'SELECT p0']);

    gates.get('SELECT p0')!.resolve(encodedSqlResult('SELECT p0'));
    await expect(p0).resolves.toMatchObject({ rows: [['SELECT p0']] });
    await flushPromises();
    expect(started).toEqual(['SELECT p2', 'SELECT p0', 'SELECT p1']);

    gates.get('SELECT p1')!.resolve(encodedSqlResult('SELECT p1'));
    await expect(p1).resolves.toMatchObject({ rows: [['SELECT p1']] });
  });

  it('keeps FIFO order inside the same priority level', async () => {
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<Buffer>>>();

    worker = new TraceProcessorSqlWorker({
      processorId: 'processor-b',
      traceId: 'trace-b',
      port: 1,
      forceInline: true,
      rawExecutor: async request => {
        const sql = decodeQueryArgsSql(request.body);
        started.push(sql);
        const gate = gates.get(sql) || deferred<Buffer>();
        gates.set(sql, gate);
        return gate.promise;
      },
    });

    const first = worker.query('SELECT first', { priority: 'p1' });
    await flushPromises();
    const second = worker.query('SELECT second', { priority: 'p1' });
    await flushPromises();
    expect(started).toEqual(['SELECT first']);

    gates.get('SELECT first')!.resolve(encodedSqlResult('SELECT first'));
    await expect(first).resolves.toMatchObject({ rows: [['SELECT first']] });
    await flushPromises();
    expect(started).toEqual(['SELECT first', 'SELECT second']);

    gates.get('SELECT second')!.resolve(encodedSqlResult('SELECT second'));
    await expect(second).resolves.toMatchObject({ rows: [['SELECT second']] });
  });

  it('normalizes public priority names', () => {
    expect(normalizeTraceProcessorQueryPriority('interactive')).toBe('p0');
    expect(normalizeTraceProcessorQueryPriority('agent')).toBe('p1');
    expect(normalizeTraceProcessorQueryPriority('report')).toBe('p2');
    expect(normalizeTraceProcessorQueryPriority('unknown', 'p2')).toBe('p2');
  });
});
