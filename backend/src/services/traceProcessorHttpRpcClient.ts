// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import http from 'http';

export interface TraceProcessorHttpRpcRequest {
  hostname?: string;
  port: number;
  path?: '/query' | '/status';
  body: Buffer;
  timeoutMs: number;
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
