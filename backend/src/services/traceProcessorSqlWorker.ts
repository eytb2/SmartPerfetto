// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import { traceProcessorConfig } from '../config';
import {
  decodeQueryResult,
  encodeQueryArgs,
} from './traceProcessorProtobuf';
import {
  executeTraceProcessorHttpRpcRaw,
  type TraceProcessorHttpRpcRequest,
} from './traceProcessorHttpRpcClient';
import type { QueryResult } from './workingTraceProcessor';

const IS_TEST_ENV = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

export type TraceProcessorQueryPriority = 'p0' | 'p1' | 'p2';

export interface TraceProcessorQueryOptions {
  priority?: TraceProcessorQueryPriority;
  timeoutMs?: number;
}

export interface TraceProcessorSqlWorkerOptions {
  processorId: string;
  traceId: string;
  port: number;
  hostname?: string;
  forceInline?: boolean;
  rawExecutor?: (request: TraceProcessorHttpRpcRequest) => Promise<Buffer>;
}

interface QueueTask {
  id: number;
  body: Buffer;
  priority: TraceProcessorQueryPriority;
  timeoutMs: number;
  resolve: (body: Buffer) => void;
  reject: (error: Error) => void;
}

interface PendingWorkerRequest {
  resolve: (body: Buffer) => void;
  reject: (error: Error) => void;
}

const PRIORITY_ORDER: TraceProcessorQueryPriority[] = ['p0', 'p1', 'p2'];

export function normalizeTraceProcessorQueryPriority(
  value: unknown,
  fallback: TraceProcessorQueryPriority = 'p1',
): TraceProcessorQueryPriority {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['p0', 'frontend', 'interactive', 'user'].includes(normalized)) return 'p0';
  if (['p1', 'agent', 'analysis', 'normal'].includes(normalized)) return 'p1';
  if (['p2', 'report', 'batch', 'heavy', 'background'].includes(normalized)) return 'p2';
  return fallback;
}

function resolveWorkerThreadPath(): { filename: string; execArgv: string[] } {
  const jsPath = path.join(__dirname, 'traceProcessorSqlWorkerThread.js');
  if (fs.existsSync(jsPath)) {
    return { filename: jsPath, execArgv: [] };
  }

  return {
    filename: path.join(__dirname, 'traceProcessorSqlWorkerThread.ts'),
    execArgv: ['--require', 'tsx/cjs'],
  };
}

export class TraceProcessorSqlWorker {
  private readonly processorId: string;
  private readonly traceId: string;
  private readonly port: number;
  private readonly hostname: string;
  private readonly forceInline: boolean;
  private readonly rawExecutor?: (request: TraceProcessorHttpRpcRequest) => Promise<Buffer>;
  private readonly queues: Record<TraceProcessorQueryPriority, QueueTask[]> = {
    p0: [],
    p1: [],
    p2: [],
  };
  private pendingWorkerRequests = new Map<number, PendingWorkerRequest>();
  private worker: Worker | null = null;
  private running = false;
  private destroyed = false;
  private nextTaskId = 1;

  constructor(options: TraceProcessorSqlWorkerOptions) {
    this.processorId = options.processorId;
    this.traceId = options.traceId;
    this.port = options.port;
    this.hostname = options.hostname || '127.0.0.1';
    this.forceInline = options.forceInline ?? IS_TEST_ENV;
    this.rawExecutor = options.rawExecutor;
  }

  get activeCount(): number {
    return (this.running ? 1 : 0) + this.queues.p0.length + this.queues.p1.length + this.queues.p2.length;
  }

  getStats(): {
    running: boolean;
    queuedP0: number;
    queuedP1: number;
    queuedP2: number;
    usesWorkerThread: boolean;
  } {
    return {
      running: this.running,
      queuedP0: this.queues.p0.length,
      queuedP1: this.queues.p1.length,
      queuedP2: this.queues.p2.length,
      usesWorkerThread: !this.forceInline && !this.rawExecutor,
    };
  }

  async query(sql: string, options: TraceProcessorQueryOptions = {}): Promise<QueryResult> {
    const startTime = Date.now();
    try {
      const response = await this.enqueueRaw(encodeQueryArgs(sql), options);
      const parsed = decodeQueryResult(response);
      return {
        columns: parsed.columnNames,
        rows: parsed.rows,
        durationMs: Date.now() - startTime,
        ...(parsed.error ? { error: parsed.error } : {}),
      };
    } catch (error: any) {
      return {
        columns: [],
        rows: [],
        durationMs: Date.now() - startTime,
        error: error?.message || String(error),
      };
    }
  }

  enqueueRaw(body: Buffer, options: TraceProcessorQueryOptions = {}): Promise<Buffer> {
    if (this.destroyed) {
      return Promise.reject(new Error(`SQL worker for processor ${this.processorId} is destroyed`));
    }

    const priority = normalizeTraceProcessorQueryPriority(options.priority);
    const timeoutMs = options.timeoutMs ?? traceProcessorConfig.queryTimeoutMs;
    const taskId = this.nextTaskId++;

    return new Promise((resolve, reject) => {
      this.queues[priority].push({
        id: taskId,
        body,
        priority,
        timeoutMs,
        resolve,
        reject,
      });
      this.drain();
    });
  }

  destroy(): void {
    this.destroyed = true;
    const error = new Error(`SQL worker for processor ${this.processorId} was destroyed`);
    for (const priority of PRIORITY_ORDER) {
      const tasks = this.queues[priority].splice(0);
      for (const task of tasks) task.reject(error);
    }
    for (const pending of this.pendingWorkerRequests.values()) {
      pending.reject(error);
    }
    this.pendingWorkerRequests.clear();
    if (this.worker) {
      void this.worker.terminate();
      this.worker = null;
    }
  }

  private drain(): void {
    if (this.running || this.destroyed) return;
    const task = this.nextTask();
    if (!task) return;

    this.running = true;
    void this.runTask(task)
      .then(task.resolve, task.reject)
      .finally(() => {
        this.running = false;
        this.drain();
      });
  }

  private nextTask(): QueueTask | undefined {
    for (const priority of PRIORITY_ORDER) {
      const task = this.queues[priority].shift();
      if (task) return task;
    }
    return undefined;
  }

  private async runTask(task: QueueTask): Promise<Buffer> {
    const request: TraceProcessorHttpRpcRequest = {
      hostname: this.hostname,
      port: this.port,
      body: task.body,
      timeoutMs: task.timeoutMs,
    };

    if (this.forceInline || this.rawExecutor) {
      return (this.rawExecutor || executeTraceProcessorHttpRpcRaw)(request);
    }

    return this.postToWorker(task);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const workerPath = resolveWorkerThreadPath();
    const worker = new Worker(workerPath.filename, {
      execArgv: workerPath.execArgv,
      env: process.env,
    });

    worker.on('message', (message: { id: number; ok: boolean; body?: Uint8Array; error?: string }) => {
      const pending = this.pendingWorkerRequests.get(message.id);
      if (!pending) return;
      this.pendingWorkerRequests.delete(message.id);
      if (message.ok) {
        pending.resolve(Buffer.from(message.body || []));
      } else {
        pending.reject(new Error(message.error || 'SQL worker query failed'));
      }
    });

    worker.on('error', error => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.rejectPendingWorkerRequests(normalized);
      this.worker = null;
    });

    worker.on('exit', code => {
      if (code !== 0 && !this.destroyed) {
        this.rejectPendingWorkerRequests(new Error(`SQL worker exited with code ${code}`));
      }
      this.worker = null;
    });

    this.worker = worker;
    return worker;
  }

  private postToWorker(task: QueueTask): Promise<Buffer> {
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pendingWorkerRequests.set(task.id, { resolve, reject });
      worker.postMessage({
        id: task.id,
        hostname: this.hostname,
        port: this.port,
        body: task.body,
        timeoutMs: task.timeoutMs,
      });
    });
  }

  private rejectPendingWorkerRequests(error: Error): void {
    for (const pending of this.pendingWorkerRequests.values()) {
      pending.reject(error);
    }
    this.pendingWorkerRequests.clear();
  }
}
