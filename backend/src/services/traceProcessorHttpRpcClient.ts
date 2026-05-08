// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import http from 'http';
import {
  decodeQueryResult,
  encodeQueryArgs,
} from './traceProcessorProtobuf';

export interface TraceProcessorHttpRpcRequest {
  hostname?: string;
  port: number;
  path?: '/query' | '/status';
  body: Buffer;
  timeoutMs: number;
}

export interface TraceProcessorHttpRpcSqlRequest {
  hostname?: string;
  port: number;
  sql: string;
  timeoutMs: number;
}

export interface TraceProcessorHttpRpcSqlResult {
  columns: string[];
  rows: any[][];
  durationMs: number;
  error?: string;
}

export async function executeTraceProcessorHttpRpcRaw(
  request: TraceProcessorHttpRpcRequest,
): Promise<Buffer> {
  const hostname = request.hostname || '127.0.0.1';
  const path = request.path || '/query';

  return new Promise((resolve, reject) => {
    let settled = false;
    let req: http.ClientRequest | null = null;
    let wallClockTimer: NodeJS.Timeout | undefined;

    const finish = (error: Error | null, body?: Buffer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(wallClockTimer);
      if (error) {
        reject(error);
      } else {
        resolve(body || Buffer.alloc(0));
      }
    };

    wallClockTimer = setTimeout(() => {
      req?.destroy();
      finish(new Error('Query timeout'));
    }, request.timeoutMs);
    if (typeof (wallClockTimer as any).unref === 'function') {
      (wallClockTimer as any).unref();
    }

    req = http.request({
      hostname,
      port: request.port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-protobuf',
        'Content-Length': request.body.length,
      },
      timeout: request.timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          finish(new Error(`HTTP ${res.statusCode}: ${responseBody.toString('utf8')}`));
          return;
        }
        finish(null, responseBody);
      });
    });

    req.on('error', error => {
      finish(error);
    });

    req.on('timeout', () => {
      req?.destroy();
      finish(new Error('Query timeout'));
    });

    req.write(request.body);
    req.end();
  });
}

export async function executeTraceProcessorHttpRpcSql(
  request: TraceProcessorHttpRpcSqlRequest,
): Promise<TraceProcessorHttpRpcSqlResult> {
  const startTime = Date.now();
  const response = await executeTraceProcessorHttpRpcRaw({
    hostname: request.hostname,
    port: request.port,
    path: '/query',
    body: encodeQueryArgs(request.sql),
    timeoutMs: request.timeoutMs,
  });
  const parsed = decodeQueryResult(response);
  return {
    columns: parsed.columnNames,
    rows: parsed.rows,
    durationMs: Date.now() - startTime,
    ...(parsed.error ? { error: parsed.error } : {}),
  };
}
