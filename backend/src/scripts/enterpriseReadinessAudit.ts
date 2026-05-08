// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

type ReadinessStatus = 'passed' | 'blocked';

export interface ReadinessCheck {
  id: string;
  status: ReadinessStatus;
  message: string;
  evidence: string[];
}

export interface EnterpriseReadinessAuditOptions {
  readmePath: string;
  acceptanceEvidencePath: string;
  loadTestReportPath: string;
  rssBenchmarkPath: string;
  releaseNotesPath: string;
  outputPath?: string;
  markdownPath?: string;
  requireReady: boolean;
}

export interface EnterpriseReadinessAuditReport {
  generatedAt: string;
  ready: boolean;
  checks: ReadinessCheck[];
  artifacts: Record<string, string>;
}

interface TodoItem {
  checked: boolean;
  text: string;
  line: number;
}

function printUsage(): void {
  console.log('Usage: npx tsx src/scripts/enterpriseReadinessAudit.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --readme <path>               README with §0 TODOs.');
  console.log('  --acceptance-evidence <path>  §0.8 acceptance evidence doc.');
  console.log('  --load-test-report <path>     §0.8 load-test report doc.');
  console.log('  --rss-benchmark <path>        §0.4.3 RSS benchmark doc.');
  console.log('  --release-notes <path>        Final release notes doc.');
  console.log('  --output <path>               JSON report path.');
  console.log('  --markdown <path>             Optional Markdown report path.');
  console.log('  --require-ready               Exit non-zero unless every readiness check passes.');
  console.log('  --help                        Show this help.');
}

function defaultDocsPath(...parts: string[]): string {
  return path.resolve(process.cwd(), '..', 'docs', 'features', 'enterprise-multi-tenant', ...parts);
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function sectionBetween(markdown: string, startHeading: string, endHeading?: string): string {
  const startIndex = markdown.indexOf(startHeading);
  if (startIndex < 0) return '';
  if (!endHeading) return markdown.slice(startIndex);
  const endIndex = markdown.indexOf(endHeading, startIndex + startHeading.length);
  return endIndex < 0 ? markdown.slice(startIndex) : markdown.slice(startIndex, endIndex);
}

function parseTodos(markdown: string): TodoItem[] {
  const items: TodoItem[] = [];
  const lines = markdown.split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/^- \[([ xX])\] (.+)$/);
    if (!match) return;
    items.push({
      checked: match[1].toLowerCase() === 'x',
      text: match[2],
      line: index + 1,
    });
  });
  return items;
}

function blocked(id: string, message: string, evidence: string[]): ReadinessCheck {
  return { id, status: 'blocked', message, evidence };
}

function passed(id: string, message: string, evidence: string[]): ReadinessCheck {
  return { id, status: 'passed', message, evidence };
}

function auditReadmeTodos(readme: string, readmePath: string): ReadinessCheck {
  const section0 = sectionBetween(readme, '## 0. 开发执行 TODO', '## 1. 文档定位');
  const todos = parseTodos(section0);
  const unchecked = todos.filter(item => !item.checked);

  if (unchecked.length > 0) {
    return blocked(
      'readme-section-0-todos',
      `README §0 still has ${unchecked.length} unchecked item(s).`,
      unchecked.map(item => `${path.basename(readmePath)}:${item.line} ${item.text}`),
    );
  }

  return passed(
    'readme-section-0-todos',
    `README §0 has ${todos.length} checked item(s) and no unchecked TODOs.`,
    [`${path.basename(readmePath)} §0`],
  );
}

function auditD1D10(readme: string): ReadinessCheck {
  const section = sectionBetween(readme, '### 0.7', '### 0.8');
  const items = parseTodos(section).filter(item => /^D(?:10|[1-9])\b/.test(item.text));
  const missingIds = Array.from({ length: 10 }, (_unused, index) => `D${index + 1}`)
    .filter(id => !items.some(item => item.text.startsWith(id)));
  const unchecked = items.filter(item => !item.checked);

  if (items.length !== 10 || missingIds.length > 0 || unchecked.length > 0) {
    return blocked(
      'd1-d10-automated-regression',
      'README §0.7 D1-D10 is not fully checked.',
      [
        `found=${items.length}`,
        `missing=${missingIds.join(', ') || 'none'}`,
        ...unchecked.map(item => `unchecked ${item.text}`),
      ],
    );
  }

  return passed(
    'd1-d10-automated-regression',
    'README §0.7 lists D1-D10 and all ten rows are checked.',
    items.map(item => item.text),
  );
}

function auditSection08(readme: string): ReadinessCheck {
  const section = sectionBetween(readme, '### 0.8', '### 0.9');
  const items = parseTodos(section);
  const unchecked = items.filter(item => !item.checked);

  if (items.length !== 11 || unchecked.length > 0) {
    return blocked(
      'section-19-acceptance',
      'README §0.8 / §19 total acceptance is not fully checked.',
      [
        `found=${items.length}`,
        ...unchecked.map(item => `unchecked ${item.text}`),
      ],
    );
  }

  return passed(
    'section-19-acceptance',
    'README §0.8 has all 11 total-acceptance rows checked.',
    items.map(item => item.text),
  );
}

function auditAcceptanceEvidence(markdown: string, filePath: string): ReadinessCheck {
  const openRows = markdown
    .split(/\r?\n/)
    .filter(line => /^\| .+ \| Open \|/.test(line));
  if (openRows.length > 0) {
    return blocked(
      'acceptance-evidence-open-rows',
      `${path.basename(filePath)} still has ${openRows.length} Open acceptance row(s).`,
      openRows,
    );
  }

  return passed(
    'acceptance-evidence-open-rows',
    `${path.basename(filePath)} has no Open acceptance rows.`,
    [path.basename(filePath)],
  );
}

function auditLoadReport(markdown: string, filePath: string): ReadinessCheck {
  const lower = markdown.toLowerCase();
  const hasPendingStatus = lower.includes('status: pending');
  const hasAcceptancePass = markdown.includes('Acceptance status: passed');

  if (hasPendingStatus || !hasAcceptancePass) {
    return blocked(
      'load-test-report-final',
      `${path.basename(filePath)} is not a final passing load-test report.`,
      [
        hasPendingStatus ? 'contains Status: pending' : 'does not contain Status: pending',
        hasAcceptancePass ? 'contains passing acceptance marker' : 'missing passing acceptance marker',
      ],
    );
  }

  return passed(
    'load-test-report-final',
    `${path.basename(filePath)} contains final passing load-test evidence.`,
    [path.basename(filePath)],
  );
}

function auditRssBenchmark(markdown: string, filePath: string): ReadinessCheck {
  const lower = markdown.toLowerCase();
  const hasBlockedLanguage = lower.includes('blocked') || lower.includes('missing required matrix cells');
  const hasCompleteMarker = markdown.includes('Coverage status: complete');

  if (hasBlockedLanguage || !hasCompleteMarker) {
    return blocked(
      'rss-benchmark-final',
      `${path.basename(filePath)} does not contain complete §0.4.3 RSS matrix evidence.`,
      [
        hasBlockedLanguage ? 'contains blocked/missing language' : 'no blocked/missing language found',
        hasCompleteMarker ? 'contains complete coverage marker' : 'missing complete coverage marker',
      ],
    );
  }

  return passed(
    'rss-benchmark-final',
    `${path.basename(filePath)} contains complete §0.4.3 RSS matrix evidence.`,
    [path.basename(filePath)],
  );
}

function auditReleaseNotes(markdown: string, filePath: string): ReadinessCheck {
  const lower = markdown.toLowerCase();
  const draftOrOpen = lower.includes('status: draft')
    || lower.includes('pending final')
    || /\| [^|\n]+ \| Open \|/.test(markdown);

  if (draftOrOpen) {
    return blocked(
      'release-notes-final',
      `${path.basename(filePath)} is still draft or contains Open acceptance rows.`,
      ['draft/pending/open marker found'],
    );
  }

  return passed(
    'release-notes-final',
    `${path.basename(filePath)} has no draft/pending/open marker.`,
    [path.basename(filePath)],
  );
}

export function parseEnterpriseReadinessAuditArgs(
  argv: string[],
  cwd = process.cwd(),
): EnterpriseReadinessAuditOptions {
  const options: EnterpriseReadinessAuditOptions = {
    readmePath: defaultDocsPath('README.md'),
    acceptanceEvidencePath: defaultDocsPath('acceptance-evidence.md'),
    loadTestReportPath: defaultDocsPath('load-test-report.md'),
    rssBenchmarkPath: defaultDocsPath('rss-benchmark.md'),
    releaseNotesPath: defaultDocsPath('release-notes.md'),
    requireReady: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--readme') {
      if (!next) throw new Error('--readme requires a value');
      options.readmePath = path.resolve(cwd, next);
      i += 1;
      continue;
    }
    if (arg === '--acceptance-evidence') {
      if (!next) throw new Error('--acceptance-evidence requires a value');
      options.acceptanceEvidencePath = path.resolve(cwd, next);
      i += 1;
      continue;
    }
    if (arg === '--load-test-report') {
      if (!next) throw new Error('--load-test-report requires a value');
      options.loadTestReportPath = path.resolve(cwd, next);
      i += 1;
      continue;
    }
    if (arg === '--rss-benchmark') {
      if (!next) throw new Error('--rss-benchmark requires a value');
      options.rssBenchmarkPath = path.resolve(cwd, next);
      i += 1;
      continue;
    }
    if (arg === '--release-notes') {
      if (!next) throw new Error('--release-notes requires a value');
      options.releaseNotesPath = path.resolve(cwd, next);
      i += 1;
      continue;
    }
    if (arg === '--output') {
      if (!next) throw new Error('--output requires a value');
      options.outputPath = path.resolve(cwd, next);
      i += 1;
      continue;
    }
    if (arg === '--markdown') {
      if (!next) throw new Error('--markdown requires a value');
      options.markdownPath = path.resolve(cwd, next);
      i += 1;
      continue;
    }
    if (arg === '--require-ready') {
      options.requireReady = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function buildEnterpriseReadinessAuditReport(
  options: EnterpriseReadinessAuditOptions,
): EnterpriseReadinessAuditReport {
  const readme = readFile(options.readmePath);
  const acceptanceEvidence = readFile(options.acceptanceEvidencePath);
  const loadTestReport = readFile(options.loadTestReportPath);
  const rssBenchmark = readFile(options.rssBenchmarkPath);
  const releaseNotes = readFile(options.releaseNotesPath);

  const checks = [
    auditReadmeTodos(readme, options.readmePath),
    auditD1D10(readme),
    auditSection08(readme),
    auditAcceptanceEvidence(acceptanceEvidence, options.acceptanceEvidencePath),
    auditLoadReport(loadTestReport, options.loadTestReportPath),
    auditRssBenchmark(rssBenchmark, options.rssBenchmarkPath),
    auditReleaseNotes(releaseNotes, options.releaseNotesPath),
  ];

  return {
    generatedAt: new Date().toISOString(),
    ready: checks.every(check => check.status === 'passed'),
    checks,
    artifacts: {
      readme: options.readmePath,
      acceptanceEvidence: options.acceptanceEvidencePath,
      loadTestReport: options.loadTestReportPath,
      rssBenchmark: options.rssBenchmarkPath,
      releaseNotes: options.releaseNotesPath,
    },
  };
}

export function determineEnterpriseReadinessAuditExitCode(
  report: EnterpriseReadinessAuditReport,
  options: Pick<EnterpriseReadinessAuditOptions, 'requireReady'>,
): number {
  return options.requireReady && !report.ready ? 2 : 0;
}

export function buildMarkdownEnterpriseReadinessAudit(report: EnterpriseReadinessAuditReport): string {
  const lines: string[] = [];
  lines.push('# Enterprise Multi-Tenant Readiness Audit');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push(`Overall status: ${report.ready ? 'ready' : 'blocked'}`);
  lines.push('');
  lines.push('| Check | Status | Message |');
  lines.push('| --- | --- | --- |');
  for (const check of report.checks) {
    lines.push(`| ${check.id} | ${check.status} | ${check.message} |`);
  }
  lines.push('');
  lines.push('## Blocking Evidence');
  lines.push('');
  const blockers = report.checks.filter(check => check.status === 'blocked');
  if (blockers.length === 0) {
    lines.push('- none');
  } else {
    for (const check of blockers) {
      lines.push(`- ${check.id}: ${check.message}`);
      for (const item of check.evidence) {
        lines.push(`  - ${item}`);
      }
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function writeReportFiles(
  report: EnterpriseReadinessAuditReport,
  options: EnterpriseReadinessAuditOptions,
): Promise<void> {
  if (options.outputPath) {
    await fsp.mkdir(path.dirname(options.outputPath), { recursive: true });
    await fsp.writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[Enterprise Readiness Audit] JSON report: ${options.outputPath}`);
  }

  if (options.markdownPath) {
    await fsp.mkdir(path.dirname(options.markdownPath), { recursive: true });
    await fsp.writeFile(options.markdownPath, buildMarkdownEnterpriseReadinessAudit(report), 'utf8');
    console.log(`[Enterprise Readiness Audit] Markdown report: ${options.markdownPath}`);
  }
}

async function main(): Promise<void> {
  const options = parseEnterpriseReadinessAuditArgs(process.argv.slice(2));
  const report = buildEnterpriseReadinessAuditReport(options);
  await writeReportFiles(report, options);

  if (!report.ready) {
    const blockers = report.checks
      .filter(check => check.status === 'blocked')
      .map(check => check.id)
      .join(', ');
    console.warn(`[Enterprise Readiness Audit] Blocked: ${blockers}`);
  }

  process.exitCode = determineEnterpriseReadinessAuditExitCode(report, options) || undefined;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[Enterprise Readiness Audit] ${error.message}`);
    process.exit(1);
  });
}
