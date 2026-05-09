// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  classifyRequiredSizeBucket,
  inferBenchmarkSceneFromPath,
  REQUIRED_RSS_BENCHMARK_SCENES,
  REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS,
  type BenchmarkCoverage,
  type RequiredScene,
  type RequiredSizeBucket,
  type SizeBucket,
} from './benchmarkTraceProcessorRss';

const MIB = 1024 * 1024;
const DEFAULT_MIN_SIZE_BYTES = 100 * MIB;
const TRACE_EXTENSIONS = new Set([
  '.trace',
  '.pftrace',
  '.perfetto-trace',
  '.pb',
  '.protobuf',
]);
const SKIPPED_DIR_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.claude',
  'node_modules',
  'dist',
  'build',
  'coverage',
]);

export interface TraceMatrixCandidate {
  scene: string;
  label: string;
  path: string;
  sizeBytes: number;
  sizeBucket: SizeBucket;
}

export interface TraceMatrixAuditOptions {
  roots: string[];
  minSizeBytes: number;
  outputPath?: string;
  markdownPath?: string;
  benchmarkManifestPath?: string;
  includeUnknownScene: boolean;
  requireCompleteMatrix: boolean;
}

export interface TraceMatrixAuditReport {
  generatedAt: string;
  roots: string[];
  minSizeBytes: number;
  host: {
    platform: string;
    arch: string;
    node: string;
  };
  requiredMatrix: {
    scenes: readonly RequiredScene[];
    sizeBuckets: readonly RequiredSizeBucket[];
  };
  coverage: BenchmarkCoverage;
  candidates: TraceMatrixCandidate[];
}

export interface TraceBenchmarkManifest {
  traces: Array<{
    scene: RequiredScene;
    label: string;
    path: string;
    sizeBucket: RequiredSizeBucket;
  }>;
}

function printUsage(): void {
  console.log('Usage: npx tsx src/scripts/auditTraceProcessorRssMatrix.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --scan-dir <path>             Directory or file to scan. Repeatable.');
  console.log('  --output <path>               JSON audit report path.');
  console.log('  --markdown <path>             Optional Markdown audit report path.');
  console.log('  --benchmark-manifest <path>   Write benchmark manifest when every matrix cell has a candidate.');
  console.log('  --min-size-mb <mb>            Minimum candidate size. Default: 100.');
  console.log('  --exclude-unknown-scene       Hide large traces whose scene cannot be inferred from filename.');
  console.log('  --require-complete-matrix     Exit non-zero if any §0.4.3 scene/size cell lacks a candidate.');
  console.log('  --help                        Show this help.');
}

function isTraceFile(filePath: string): boolean {
  return TRACE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function maybeCreateCandidate(
  filePath: string,
  options: Pick<TraceMatrixAuditOptions, 'minSizeBytes' | 'includeUnknownScene'>,
): Promise<TraceMatrixCandidate | null> {
  if (!isTraceFile(filePath)) return null;
  const stat = await fsp.stat(filePath);
  if (!stat.isFile() || stat.size < options.minSizeBytes) return null;

  const scene = inferBenchmarkSceneFromPath(filePath);
  if (scene === 'unknown' && !options.includeUnknownScene) return null;

  return {
    scene,
    label: path.basename(filePath),
    path: filePath,
    sizeBytes: stat.size,
    sizeBucket: classifyRequiredSizeBucket(stat.size),
  };
}

async function scanPath(
  root: string,
  options: Pick<TraceMatrixAuditOptions, 'minSizeBytes' | 'includeUnknownScene'>,
  candidates: TraceMatrixCandidate[],
): Promise<void> {
  let stat;
  try {
    stat = await fsp.lstat(root);
  } catch {
    return;
  }

  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    const candidate = await maybeCreateCandidate(root, options);
    if (candidate) candidates.push(candidate);
    return;
  }
  if (!stat.isDirectory()) return;

  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && SKIPPED_DIR_NAMES.has(entry.name)) continue;
    await scanPath(path.join(root, entry.name), options, candidates);
  }
}

function sortCandidates(candidates: TraceMatrixCandidate[]): TraceMatrixCandidate[] {
  const sceneOrder = new Map<string, number>(REQUIRED_RSS_BENCHMARK_SCENES.map((scene, index) => [scene, index]));
  const bucketOrder = new Map<string, number>(REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS.map((bucket, index) => [bucket, index]));
  return [...candidates].sort((left, right) => {
    const leftScene = sceneOrder.get(left.scene) ?? Number.MAX_SAFE_INTEGER;
    const rightScene = sceneOrder.get(right.scene) ?? Number.MAX_SAFE_INTEGER;
    if (leftScene !== rightScene) return leftScene - rightScene;
    const leftBucket = bucketOrder.get(left.sizeBucket as RequiredSizeBucket) ?? Number.MAX_SAFE_INTEGER;
    const rightBucket = bucketOrder.get(right.sizeBucket as RequiredSizeBucket) ?? Number.MAX_SAFE_INTEGER;
    if (leftBucket !== rightBucket) return leftBucket - rightBucket;
    if (left.sizeBytes !== right.sizeBytes) return right.sizeBytes - left.sizeBytes;
    return left.path.localeCompare(right.path);
  });
}

export async function collectTraceMatrixCandidates(
  roots: string[],
  options: Partial<Pick<TraceMatrixAuditOptions, 'minSizeBytes' | 'includeUnknownScene'>> = {},
): Promise<TraceMatrixCandidate[]> {
  const scanOptions = {
    minSizeBytes: options.minSizeBytes ?? DEFAULT_MIN_SIZE_BYTES,
    includeUnknownScene: options.includeUnknownScene ?? true,
  };
  const candidates: TraceMatrixCandidate[] = [];
  for (const root of roots) {
    await scanPath(path.resolve(root), scanOptions, candidates);
  }

  const byPath = new Map<string, TraceMatrixCandidate>();
  for (const candidate of candidates) {
    byPath.set(candidate.path, candidate);
  }
  return sortCandidates(Array.from(byPath.values()));
}

export function computeTraceMatrixCandidateCoverage(candidates: TraceMatrixCandidate[]): BenchmarkCoverage {
  const observed = new Set<string>();
  for (const candidate of candidates) {
    if (!(REQUIRED_RSS_BENCHMARK_SCENES as readonly string[]).includes(candidate.scene)) continue;
    if (!(REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS as readonly string[]).includes(candidate.sizeBucket)) continue;
    observed.add(`${candidate.scene}:${candidate.sizeBucket}`);
  }

  const missingCells: string[] = [];
  for (const scene of REQUIRED_RSS_BENCHMARK_SCENES) {
    for (const sizeBucket of REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS) {
      const cell = `${scene}:${sizeBucket}`;
      if (!observed.has(cell)) missingCells.push(cell);
    }
  }

  return {
    complete: missingCells.length === 0,
    missingCells,
    observedCells: Array.from(observed).sort(),
  };
}

export function parseTraceMatrixAuditArgs(argv: string[], cwd = process.cwd()): TraceMatrixAuditOptions {
  const roots: string[] = [];
  let outputPath: string | undefined;
  let markdownPath: string | undefined;
  let benchmarkManifestPath: string | undefined;
  let minSizeBytes = DEFAULT_MIN_SIZE_BYTES;
  let includeUnknownScene = true;
  let requireCompleteMatrix = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--scan-dir') {
      if (!next) throw new Error('--scan-dir requires a value');
      roots.push(path.resolve(cwd, next));
      i += 1;
      continue;
    }
    if (arg === '--output') {
      if (!next) throw new Error('--output requires a value');
      outputPath = path.resolve(cwd, next);
      i += 1;
      continue;
    }
    if (arg === '--markdown') {
      if (!next) throw new Error('--markdown requires a value');
      markdownPath = path.resolve(cwd, next);
      i += 1;
      continue;
    }
    if (arg === '--benchmark-manifest') {
      if (!next) throw new Error('--benchmark-manifest requires a value');
      benchmarkManifestPath = path.resolve(cwd, next);
      i += 1;
      continue;
    }
    if (arg === '--min-size-mb') {
      if (!next) throw new Error('--min-size-mb requires a value');
      const minSizeMb = Number.parseInt(next, 10);
      if (!Number.isInteger(minSizeMb) || minSizeMb < 0) {
        throw new Error('--min-size-mb must be an integer >= 0');
      }
      minSizeBytes = minSizeMb * MIB;
      i += 1;
      continue;
    }
    if (arg === '--exclude-unknown-scene') {
      includeUnknownScene = false;
      continue;
    }
    if (arg === '--require-complete-matrix') {
      requireCompleteMatrix = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    roots,
    minSizeBytes,
    outputPath,
    markdownPath,
    benchmarkManifestPath,
    includeUnknownScene,
    requireCompleteMatrix,
  };
}

export async function buildTraceMatrixAuditReport(options: TraceMatrixAuditOptions): Promise<TraceMatrixAuditReport> {
  if (options.roots.length === 0) {
    throw new Error('No scan roots provided. Pass --scan-dir at least once.');
  }

  const candidates = await collectTraceMatrixCandidates(options.roots, {
    minSizeBytes: options.minSizeBytes,
    includeUnknownScene: options.includeUnknownScene,
  });

  return {
    generatedAt: new Date().toISOString(),
    roots: options.roots,
    minSizeBytes: options.minSizeBytes,
    host: {
      platform: os.platform(),
      arch: os.arch(),
      node: process.version,
    },
    requiredMatrix: {
      scenes: REQUIRED_RSS_BENCHMARK_SCENES,
      sizeBuckets: REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS,
    },
    coverage: computeTraceMatrixCandidateCoverage(candidates),
    candidates,
  };
}

export function determineTraceMatrixAuditExitCode(
  report: TraceMatrixAuditReport,
  options: Pick<TraceMatrixAuditOptions, 'requireCompleteMatrix'>,
): number {
  if (options.requireCompleteMatrix && !report.coverage.complete) return 2;
  return 0;
}

function formatBytes(value: number): string {
  if (value >= 1024 * MIB) return `${(value / (1024 * MIB)).toFixed(2)} GiB`;
  return `${(value / MIB).toFixed(1)} MiB`;
}

export function buildMarkdownAuditReport(report: TraceMatrixAuditReport): string {
  const lines: string[] = [];
  lines.push('# Trace Processor RSS Matrix Candidate Audit');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('This audit only checks candidate trace availability. It is not RSS benchmark evidence.');
  lines.push('');
  lines.push(`Coverage status: ${report.coverage.complete ? 'candidate_matrix_ready' : 'blocked_missing_required_traces'}`);
  lines.push('');
  lines.push('Scan roots:');
  lines.push('');
  for (const root of report.roots) {
    lines.push(`- ${root}`);
  }
  lines.push('');
  lines.push(`Minimum candidate size: ${formatBytes(report.minSizeBytes)}`);
  lines.push('');
  lines.push('| Trace | Scene | Size bucket | File size | Path |');
  lines.push('| --- | --- | --- | ---: | --- |');
  if (report.candidates.length === 0) {
    lines.push('| none | n/a | n/a | n/a | n/a |');
  } else {
    for (const candidate of report.candidates) {
      lines.push([
        `| ${candidate.label}`,
        candidate.scene,
        candidate.sizeBucket,
        formatBytes(candidate.sizeBytes),
        `${candidate.path} |`,
      ].join(' | '));
    }
  }
  lines.push('');
  lines.push('Observed candidate matrix cells:');
  lines.push('');
  if (report.coverage.observedCells.length === 0) {
    lines.push('- none');
  } else {
    for (const cell of report.coverage.observedCells) {
      lines.push(`- ${cell}`);
    }
  }
  lines.push('');
  lines.push('Missing required matrix cells:');
  lines.push('');
  if (report.coverage.missingCells.length === 0) {
    lines.push('- none');
  } else {
    for (const cell of report.coverage.missingCells) {
      lines.push(`- ${cell}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function buildBenchmarkManifest(report: TraceMatrixAuditReport): TraceBenchmarkManifest {
  if (!report.coverage.complete) {
    throw new Error(`Cannot write benchmark manifest; missing cells: ${report.coverage.missingCells.join(', ')}`);
  }

  const selected = new Map<string, TraceMatrixCandidate>();
  for (const candidate of report.candidates) {
    if (!(REQUIRED_RSS_BENCHMARK_SCENES as readonly string[]).includes(candidate.scene)) continue;
    if (!(REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS as readonly string[]).includes(candidate.sizeBucket)) continue;
    const key = `${candidate.scene}:${candidate.sizeBucket}`;
    const existing = selected.get(key);
    if (!existing || candidate.sizeBytes > existing.sizeBytes) {
      selected.set(key, candidate);
    }
  }

  const traces: TraceBenchmarkManifest['traces'] = [];
  for (const scene of REQUIRED_RSS_BENCHMARK_SCENES) {
    for (const sizeBucket of REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS) {
      const candidate = selected.get(`${scene}:${sizeBucket}`);
      if (!candidate) {
        throw new Error(`Cannot write benchmark manifest; missing cell: ${scene}:${sizeBucket}`);
      }
      traces.push({
        scene,
        label: candidate.label,
        path: candidate.path,
        sizeBucket,
      });
    }
  }

  return { traces };
}

async function writeAuditReport(report: TraceMatrixAuditReport, options: TraceMatrixAuditOptions): Promise<void> {
  const outputPath = options.outputPath
    ?? path.resolve(process.cwd(), 'test-output/trace-processor-rss-matrix-audit.json');
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[RSS Matrix Audit] JSON report: ${outputPath}`);

  if (options.markdownPath) {
    await fsp.mkdir(path.dirname(options.markdownPath), { recursive: true });
    await fsp.writeFile(options.markdownPath, buildMarkdownAuditReport(report), 'utf8');
    console.log(`[RSS Matrix Audit] Markdown report: ${options.markdownPath}`);
  }

  if (options.benchmarkManifestPath) {
    if (!report.coverage.complete) {
      console.warn(
        `[RSS Matrix Audit] Benchmark manifest skipped; missing required candidates: ${report.coverage.missingCells.join(', ')}`,
      );
      return;
    }
    const manifest = buildBenchmarkManifest(report);
    await fsp.mkdir(path.dirname(options.benchmarkManifestPath), { recursive: true });
    await fsp.writeFile(options.benchmarkManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`[RSS Matrix Audit] Benchmark manifest: ${options.benchmarkManifestPath}`);
  }
}

async function main(): Promise<void> {
  const options = parseTraceMatrixAuditArgs(process.argv.slice(2));
  const report = await buildTraceMatrixAuditReport(options);
  await writeAuditReport(report, options);

  if (!report.coverage.complete) {
    console.warn(`[RSS Matrix Audit] Missing required §0.4.3 candidates: ${report.coverage.missingCells.join(', ')}`);
  }

  process.exitCode = determineTraceMatrixAuditExitCode(report, options) || undefined;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[RSS Matrix Audit] ${error.message}`);
    process.exit(1);
  });
}
