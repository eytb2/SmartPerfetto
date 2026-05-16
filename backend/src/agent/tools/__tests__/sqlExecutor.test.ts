// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { describe, it, expect, jest } from '@jest/globals';
import { sqlExecutorTool } from '../sqlExecutor';

describe('sqlExecutorTool', () => {
  it('enforces validation/limit and clips oversized result sets', async () => {
    const query = jest.fn(async (_traceId: string, sql: string) => {
      if (sql.includes('sqlite_master')) {
        return { columns: ['name'], rows: [['slice']] };
      }
      return {
        columns: ['id'],
        rows: Array.from({ length: 1200 }, (_, i) => [i]),
      };
    });

    const result = await sqlExecutorTool.execute(
      { sql: 'SELECT id FROM slice' },
      {
        traceId: 'trace-1',
        traceProcessorService: { query },
      } as any
    );

    expect(result.success).toBe(true);
    expect(result.data?.rowCount).toBe(1000);
    expect(result.metadata?.rowsClipped).toBe(true);
    expect((query.mock.calls[1]?.[1] as string) || '').toContain('LIMIT 1000');
  });

  it('rejects non-SELECT SQL statements', async () => {
    const query = jest.fn(async (_traceId: string, sql: string) => {
      if (sql.includes('sqlite_master')) {
        return { columns: ['name'], rows: [['slice']] };
      }
      return { columns: [], rows: [] };
    });

    const result = await sqlExecutorTool.execute(
      { sql: 'DELETE FROM slice' },
      {
        traceId: 'trace-2',
        traceProcessorService: { query },
      } as any
    );

    expect(result.success).toBe(false);
    expect(result.error || '').toContain('SQL validation failed');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('auto-injects stdlib modules before executing legacy agent SQL', async () => {
    const query = jest.fn(async (_traceId: string, sql: string) => {
      if (sql.includes('sqlite_master')) {
        return { columns: ['name'], rows: [['slice']] };
      }
      return { columns: ['self_dur'], rows: [[123]] };
    });

    const result = await sqlExecutorTool.execute(
      { sql: 'SELECT self_dur FROM slice_self_dur' },
      {
        traceId: 'trace-3',
        traceProcessorService: { query },
      } as any
    );

    expect(result.success).toBe(true);
    const executedSql = (query.mock.calls[1]?.[1] as string) || '';
    expect(executedSql).toMatch(/^INCLUDE PERFETTO MODULE slices\.self_dur;/);
    expect(executedSql).toContain('SELECT self_dur FROM slice_self_dur LIMIT 1000');
    expect(result.metadata?.stdlibInjectedModules).toEqual(['slices.self_dur']);
  });
});
