// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import {
  parseProcStatusRssBytes,
  parsePsRssBytes,
  readProcessRssBytes,
} from '../processRss';

describe('process RSS sampling', () => {
  it('parses Linux procfs VmRSS in bytes', () => {
    expect(parseProcStatusRssBytes([
      'Name:\ttrace_processor',
      'State:\tS (sleeping)',
      'VmRSS:\t  12345 kB',
      'Threads:\t4',
    ].join('\n'))).toBe(12345 * 1024);
  });

  it('returns null when procfs status does not include VmRSS', () => {
    expect(parseProcStatusRssBytes('Name:\ttrace_processor\n')).toBeNull();
  });

  it('parses ps rss output in bytes', () => {
    expect(parsePsRssBytes('  2048\n')).toBe(2048 * 1024);
  });

  it('rejects invalid pids before shelling out', () => {
    const sample = readProcessRssBytes(0);

    expect(sample).toEqual({
      pid: 0,
      rssBytes: null,
      source: 'unavailable',
      error: 'pid must be a positive integer',
    });
  });

  it('can sample the current process on supported local platforms', () => {
    const sample = readProcessRssBytes(process.pid);

    expect(sample.pid).toBe(process.pid);
    expect(sample.source).not.toBe('unavailable');
    expect(sample.rssBytes).toBeGreaterThan(0);
  });
});
