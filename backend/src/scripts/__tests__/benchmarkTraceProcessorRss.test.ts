// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import path from 'path';
import {
  buildMarkdownReport,
  classifyRequiredSizeBucket,
  computeBenchmarkCoverage,
  determineBenchmarkExitCode,
  parseBenchmarkArgs,
  REQUIRED_RSS_BENCHMARK_SCENES,
  REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS,
  type BenchmarkReport,
  type TraceBenchmarkResult,
} from '../benchmarkTraceProcessorRss';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

function result(scene: string, sizeBucket: TraceBenchmarkResult['sizeBucket']): TraceBenchmarkResult {
  return {
    traceId: `${scene}-${sizeBucket}`,
    scene,
    label: `${scene}-${sizeBucket}`,
    path: `/traces/${scene}-${sizeBucket}.pftrace`,
    sizeBytes: sizeBucket === '1GB' ? GIB : 100 * MIB,
    sizeBucket,
    status: 'passed',
    initializeMs: 10,
    rssSummary: {
      startupRssBytes: 1,
      loadPeakRssBytes: 2,
      postLoadRssBytes: 2,
      queryPeakRssBytes: 3,
      queryIncrementalRssBytes: 1,
      queryHeadroomBytes: 4,
      maxRssBytes: 3,
      traceSizeToLoadPeakRatio: 0.1,
    },
    queries: [],
    samples: [],
  };
}

describe('trace processor RSS benchmark helpers', () => {
  it('classifies required trace size buckets', () => {
    expect(classifyRequiredSizeBucket(99 * MIB)).toBe('under-100MB');
    expect(classifyRequiredSizeBucket(100 * MIB)).toBe('100MB');
    expect(classifyRequiredSizeBucket(500 * MIB)).toBe('500MB');
    expect(classifyRequiredSizeBucket(GIB)).toBe('1GB');
  });

  it('parses repeatable trace args and explicit output paths', () => {
    const cwd = '/tmp/smartperfetto';
    const options = parseBenchmarkArgs([
      '--trace', 'scroll=fixtures/scroll.pftrace',
      '--trace', 'fixtures/launch_light.pftrace',
      '--output', 'out/report.json',
      '--markdown', 'out/report.md',
      '--sample-interval-ms', '100',
      '--query', 'slice_names=SELECT name FROM slice LIMIT 1',
      '--require-complete-matrix',
    ], cwd);

    expect(options.traces).toEqual([
      {
        scene: 'scroll',
        path: path.resolve(cwd, 'fixtures/scroll.pftrace'),
        label: 'scroll-scroll.pftrace',
      },
      {
        scene: 'startup',
        path: path.resolve(cwd, 'fixtures/launch_light.pftrace'),
        label: 'startup-launch_light.pftrace',
      },
    ]);
    expect(options.outputPath).toBe(path.resolve(cwd, 'out/report.json'));
    expect(options.markdownPath).toBe(path.resolve(cwd, 'out/report.md'));
    expect(options.sampleIntervalMs).toBe(100);
    expect(options.requireCompleteMatrix).toBe(true);
    expect(options.queries.map(query => query.name)).toContain('slice_names');
  });

  it('marks the §0.4.3 matrix incomplete when required scene/size cells are missing', () => {
    const coverage = computeBenchmarkCoverage([
      result('scroll', '100MB'),
      result('startup', '500MB'),
      result('startup', 'under-100MB'),
    ]);

    expect(coverage.complete).toBe(false);
    expect(coverage.observedCells).toEqual(['scroll:100MB', 'startup:500MB']);
    expect(coverage.missingCells).toContain('scroll:500MB');
    expect(coverage.missingCells).toContain('vendor:1GB');
  });

  it('marks the §0.4.3 matrix complete only after every scene and size bucket is covered', () => {
    const fullMatrix = REQUIRED_RSS_BENCHMARK_SCENES.flatMap(scene =>
      REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS.map(sizeBucket => result(scene, sizeBucket))
    );

    const coverage = computeBenchmarkCoverage(fullMatrix);

    expect(coverage).toEqual({
      complete: true,
      missingCells: [],
      observedCells: fullMatrix
        .map(entry => `${entry.scene}:${entry.sizeBucket}`)
        .sort(),
    });
  });

  it('renders a markdown report with explicit missing matrix cells', () => {
    const report: BenchmarkReport = {
      generatedAt: '2026-05-08T00:00:00.000Z',
      traceProcessorPath: '/tmp/trace_processor_shell',
      host: {
        platform: 'darwin',
        arch: 'arm64',
        node: 'v24.15.0',
        totalMemoryBytes: 64 * GIB,
        freeMemoryBytesAtStart: 32 * GIB,
        cpuCount: 12,
      },
      sampleIntervalMs: 250,
      requiredMatrix: {
        scenes: REQUIRED_RSS_BENCHMARK_SCENES,
        sizeBuckets: REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS,
      },
      coverage: computeBenchmarkCoverage([result('scroll', '100MB')]),
      traces: [result('scroll', '100MB')],
    };

    const markdown = buildMarkdownReport(report);

    expect(markdown).toContain('Coverage status: blocked_missing_required_traces');
    expect(markdown).toContain('Query headroom');
    expect(markdown).toContain('- startup:100MB');
    expect(markdown).toContain('| scroll-100MB | scroll | 100MB |');
  });

  it('requires the complete matrix only when requested', () => {
    const incompleteReport: BenchmarkReport = {
      generatedAt: '2026-05-08T00:00:00.000Z',
      traceProcessorPath: '/tmp/trace_processor_shell',
      host: {
        platform: 'darwin',
        arch: 'arm64',
        node: 'v24.15.0',
        totalMemoryBytes: 64 * GIB,
        freeMemoryBytesAtStart: 32 * GIB,
        cpuCount: 12,
      },
      sampleIntervalMs: 250,
      requiredMatrix: {
        scenes: REQUIRED_RSS_BENCHMARK_SCENES,
        sizeBuckets: REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS,
      },
      coverage: computeBenchmarkCoverage([result('scroll', '100MB')]),
      traces: [result('scroll', '100MB')],
    };
    const completeReport: BenchmarkReport = {
      ...incompleteReport,
      coverage: computeBenchmarkCoverage(REQUIRED_RSS_BENCHMARK_SCENES.flatMap(scene =>
        REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS.map(sizeBucket => result(scene, sizeBucket))
      )),
    };
    const failedReport: BenchmarkReport = {
      ...completeReport,
      traces: [{ ...result('scroll', '100MB'), status: 'failed', error: 'init failed' }],
    };

    expect(determineBenchmarkExitCode(incompleteReport, { requireCompleteMatrix: false })).toBe(0);
    expect(determineBenchmarkExitCode(incompleteReport, { requireCompleteMatrix: true })).toBe(2);
    expect(determineBenchmarkExitCode(completeReport, { requireCompleteMatrix: true })).toBe(0);
    expect(determineBenchmarkExitCode(failedReport, { requireCompleteMatrix: true })).toBe(1);
  });
});
