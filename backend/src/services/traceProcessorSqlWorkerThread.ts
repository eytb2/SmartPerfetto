// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { parentPort } from 'worker_threads';
import { executeTraceProcessorHttpRpcRaw } from './traceProcessorHttpRpcClient';

interface WorkerQueryMessage {
  id: number;
  hostname?: string;
  port: number;
  body: Uint8Array;
  timeoutMs: number;
}

if (!parentPort) {
  throw new Error('traceProcessorSqlWorkerThread must run inside a worker_thread');
}

parentPort.on('message', (message: WorkerQueryMessage) => {
  void (async () => {
    try {
      const body = await executeTraceProcessorHttpRpcRaw({
        hostname: message.hostname,
        port: message.port,
        body: Buffer.from(message.body),
        timeoutMs: message.timeoutMs,
      });
      parentPort!.postMessage({
        id: message.id,
        ok: true,
        body,
      });
    } catch (error: any) {
      parentPort!.postMessage({
        id: message.id,
        ok: false,
        error: error?.message || String(error),
      });
    }
  })();
});
