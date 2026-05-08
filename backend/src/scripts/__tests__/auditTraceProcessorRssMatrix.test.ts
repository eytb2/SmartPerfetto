// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  buildMarkdownAuditReport,
  collectTraceMatrixCandidates,
  computeTraceMatrixCandidateCoverage,
  determineTraceMatrixAuditExitCode,
  parseTraceMatrixAuditArgs,
  type TraceMatrixAuditReport,
  type TraceMatrixCandidate,
} from '../auditTraceProcessorRssMatrix';
import {
  REQUIRED_RSS_BENCHMARK_SCENES,
  REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS,
} from '../benchmarkTraceProcessorRss';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

async function sparseFile(filePath: string, sizeBytes: number): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const file = await fsp.open(filePath, 'w');
  try {
    await file.truncate(sizeBytes);
  } finally {
    await file.close();
  }
}

function candidate(scene: string, sizeBucket: TraceMatrixCandidate['sizeBucket']): TraceMatrixCandidate {
  return {
    scene,
    label: `${scene}-${sizeBucket}.pftrace`,
    path: `/traces/${scene}-${sizeBucket}.pftrace`,
    sizeBytes: sizeBucket === '1GB'
      ? GIB
      : sizeBucket === '500MB'
        ? 500 * MIB
        : 100 * MIB,
    sizeBucket,
  };
}

describe('trace processor RSS matrix audit helpers', () => {
  it('parses scan roots and complete-matrix requirements', () => {
    const cwd = '/tmp/smartperfetto';
    const options = parseTraceMatrixAuditArgs([
      '--scan-dir', 'traces',
      '--output', 'out/audit.json',
      '--markdown', 'out/audit.md',
      '--min-size-mb', '50',
      '--exclude-unknown-scene',
      '--require-complete-matrix',
    ], cwd);

    expect(options).toEqual({
      roots: [path.resolve(cwd, 'traces')],
      outputPath: path.resolve(cwd, 'out/audit.json'),
      markdownPath: path.resolve(cwd, 'out/audit.md'),
      minSizeBytes: 50 * MIB,
      includeUnknownScene: false,
      requireCompleteMatrix: true,
    });
  });

  it('collects large trace candidates without benchmarking them', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rss-matrix-audit-'));
    try {
      await sparseFile(path.join(tmpDir, 'scroll-big.perfetto-trace'), 100 * MIB);
      await sparseFile(path.join(tmpDir, 'StartUp_big.trace'), 100 * MIB);
      await sparseFile(path.join(tmpDir, 'small-scroll.pftrace'), MIB);
      await sparseFile(path.join(tmpDir, 'notes.txt'), 200 * MIB);

      const candidates = await collectTraceMatrixCandidates([tmpDir]);

      expect(candidates.map(entry => ({
        scene: entry.scene,
        label: entry.label,
        sizeBucket: entry.sizeBucket,
      }))).toEqual([
        {
          scene: 'scroll',
          label: 'scroll-big.perfetto-trace',
          sizeBucket: '100MB',
        },
        {
          scene: 'startup',
          label: 'StartUp_big.trace',
          sizeBucket: '100MB',
        },
      ]);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('marks candidate coverage complete only when every required cell is present', () => {
    const incompleteCoverage = computeTraceMatrixCandidateCoverage([
      candidate('scroll', '100MB'),
      candidate('startup', '500MB'),
      candidate('unknown', '1GB'),
    ]);
    const fullMatrix = REQUIRED_RSS_BENCHMARK_SCENES.flatMap(scene =>
      REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS.map(sizeBucket => candidate(scene, sizeBucket))
    );

    expect(incompleteCoverage.complete).toBe(false);
    expect(incompleteCoverage.observedCells).toEqual(['scroll:100MB', 'startup:500MB']);
    expect(incompleteCoverage.missingCells).toContain('vendor:1GB');
    expect(computeTraceMatrixCandidateCoverage(fullMatrix)).toEqual({
      complete: true,
      missingCells: [],
      observedCells: fullMatrix.map(entry => `${entry.scene}:${entry.sizeBucket}`).sort(),
    });
  });

  it('renders markdown that separates candidate availability from RSS evidence', () => {
    const report: TraceMatrixAuditReport = {
      generatedAt: '2026-05-09T00:00:00.000Z',
      roots: ['/traces'],
      minSizeBytes: 100 * MIB,
      host: {
        platform: 'darwin',
        arch: 'arm64',
        node: 'v24.15.0',
      },
      requiredMatrix: {
        scenes: REQUIRED_RSS_BENCHMARK_SCENES,
        sizeBuckets: REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS,
      },
      coverage: computeTraceMatrixCandidateCoverage([candidate('scroll', '100MB')]),
      candidates: [candidate('scroll', '100MB')],
    };

    const markdown = buildMarkdownAuditReport(report);

    expect(markdown).toContain('This audit only checks candidate trace availability. It is not RSS benchmark evidence.');
    expect(markdown).toContain('Coverage status: blocked_missing_required_traces');
    expect(markdown).toContain('| scroll-100MB.pftrace | scroll | 100MB |');
    expect(markdown).toContain('- startup:100MB');
  });

  it('fails complete-matrix audit only when required', () => {
    const report: TraceMatrixAuditReport = {
      generatedAt: '2026-05-09T00:00:00.000Z',
      roots: ['/traces'],
      minSizeBytes: 100 * MIB,
      host: {
        platform: 'darwin',
        arch: 'arm64',
        node: 'v24.15.0',
      },
      requiredMatrix: {
        scenes: REQUIRED_RSS_BENCHMARK_SCENES,
        sizeBuckets: REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS,
      },
      coverage: computeTraceMatrixCandidateCoverage([candidate('scroll', '100MB')]),
      candidates: [candidate('scroll', '100MB')],
    };

    expect(determineTraceMatrixAuditExitCode(report, { requireCompleteMatrix: false })).toBe(0);
    expect(determineTraceMatrixAuditExitCode(report, { requireCompleteMatrix: true })).toBe(2);
  });
});
