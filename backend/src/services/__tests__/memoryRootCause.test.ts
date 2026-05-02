// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import {describe, it, expect} from '@jest/globals';
import {buildMemoryRootCause} from '../memoryRootCause';
import {isUnsupported} from '../../types/sparkContracts';

describe('buildMemoryRootCause', () => {
  it('passes process / LMK / DMABUF facets through with provenance', () => {
    const c = buildMemoryRootCause({
      range: {startNs: 0, endNs: 60_000_000_000},
      processSnapshots: [
        {pid: 1, ts: 1, rssBytes: 100_000_000},
      ],
      lmkEvents: [{ts: 1, pid: 2, oomScoreAdj: 600, freedBytes: 50_000_000}],
      dmaAllocations: [{ts: 1, bufferBytes: 30_000_000, allocator: 'dmabuf'}],
    });
    expect(c.processSnapshots).toHaveLength(1);
    expect(c.lmkEvents).toHaveLength(1);
    expect(c.dmaAllocations).toHaveLength(1);
  });

  it('builds topContributors sorted by absolute delta', () => {
    const c = buildMemoryRootCause({
      range: {startNs: 0, endNs: 1},
      baseline: {
        baselineId: 'app/cold_start',
        deltaBytes: 100_000_000,
        perCategoryBytes: {
          graphics_buffer: 60_000_000,
          java_heap: 40_000_000,
          dmabuf: -10_000_000,
        },
      },
    });
    const tops = c.baselineDiff?.topContributors;
    expect(tops?.[0].key).toBe('graphics_buffer');
    expect(tops?.[1].key).toBe('java_heap');
    expect(tops?.[2].key).toBe('dmabuf');
  });

  it('flags Spark #51/#70/#109 implemented when LeakCanary artifact present', () => {
    const c = buildMemoryRootCause({
      range: {startNs: 0, endNs: 1},
      externalArtifacts: [{kind: 'leak_canary', summary: 'leaked Activity'}],
    });
    const status51 = c.coverage.find(x => x.sparkId === 51)?.status;
    const status112 = c.coverage.find(x => x.sparkId === 112)?.status;
    expect(status51).toBe('implemented');
    expect(status112).toBe('scaffolded');
  });

  it('marks unsupported when every facet is omitted', () => {
    const c = buildMemoryRootCause({range: {startNs: 0, endNs: 1}});
    expect(isUnsupported(c)).toBe(true);
  });
});
