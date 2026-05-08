// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  TraceProcessorFactory,
  type QueryResult,
} from '../workingTraceProcessor';
import {
  TraceProcessorService,
  type TraceProcessor,
} from '../traceProcessorService';

function okResult(label: string): QueryResult {
  return {
    columns: ['source'],
    rows: [[label]],
    durationMs: 1,
  };
}

function fakeProcessor(id: string, traceId: string): TraceProcessor {
  return {
    id,
    traceId,
    status: 'ready',
    activeQueries: 0,
    query: jest.fn(async () => okResult(id)),
    queryRaw: jest.fn(async (body: Buffer) => Buffer.from(`${id}:${body.toString('utf8')}`)),
    destroy: jest.fn(),
  };
}

describe('TraceProcessorService lease processor routing', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    TraceProcessorFactory.cleanup();
  });

  it('routes shared work by traceId and isolated work by lease processor key', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-lease-routing-'));
    try {
      const traceId = 'trace-a';
      const tracePath = path.join(tmpDir, `${traceId}.trace`);
      await fs.writeFile(tracePath, 'trace bytes');

      const service = new TraceProcessorService(tmpDir);
      await service.initializeUploadWithId(traceId, 'trace-a.trace', 11, tracePath);

      const shared = fakeProcessor('shared-processor', traceId);
      const isolated = fakeProcessor('isolated-processor', traceId);
      const createSpy = jest
        .spyOn(TraceProcessorFactory, 'create')
        .mockImplementation(async (_traceId, _tracePath, options) => {
          return (options?.leaseMode === 'isolated' ? isolated : shared) as any;
        });

      await service.ensureProcessorForLease(traceId, 'shared-lease', 'shared');
      await service.ensureProcessorForLease(traceId, 'isolated-lease', 'isolated');

      expect(createSpy).toHaveBeenNthCalledWith(1, traceId, tracePath, expect.objectContaining({
        processorKey: traceId,
        leaseId: 'shared-lease',
        leaseMode: 'shared',
      }));
      expect(createSpy).toHaveBeenNthCalledWith(2, traceId, tracePath, expect.objectContaining({
        processorKey: `${traceId}:lease:isolated-lease`,
        leaseId: 'isolated-lease',
        leaseMode: 'isolated',
      }));

      await expect(service.query(traceId, 'SELECT shared')).resolves.toMatchObject({
        rows: [['shared-processor']],
      });
      await expect(service.runWithLease(
        { traceId, leaseId: 'isolated-lease', mode: 'isolated' },
        () => service.query(traceId, 'SELECT isolated'),
      )).resolves.toMatchObject({
        rows: [['isolated-processor']],
      });
      await expect(service.queryRaw(traceId, Buffer.from('raw'), {
        leaseId: 'isolated-lease',
        leaseMode: 'isolated',
      })).resolves.toEqual(Buffer.from('isolated-processor:raw'));

      expect(shared.query).toHaveBeenCalledWith('SELECT shared', {});
      expect(isolated.query).toHaveBeenCalledWith('SELECT isolated', {});
      expect(isolated.queryRaw).toHaveBeenCalledWith(Buffer.from('raw'), {});
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
