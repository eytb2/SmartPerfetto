// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  buildEnterpriseReadinessAuditReport,
  buildMarkdownEnterpriseReadinessAudit,
  determineEnterpriseReadinessAuditExitCode,
  parseEnterpriseReadinessAuditArgs,
} from '../enterpriseReadinessAudit';

async function writeFixture(root: string, name: string, content: string): Promise<string> {
  const filePath = path.join(root, name);
  await fsp.writeFile(filePath, content, 'utf8');
  return filePath;
}

function completeReadme(): string {
  const section08Rows = Array.from({ length: 11 }, (_unused, index) => `- [x] §19 item ${index + 1}`).join('\n');
  const dRows = Array.from({ length: 10 }, (_unused, index) => `- [x] D${index + 1} scenario`).join('\n');
  return [
    '# README',
    '',
    '## 0. 开发执行 TODO',
    '- [x] setup',
    '### 0.7 §23 反证循环',
    dRows,
    '### 0.8 §19 总验收',
    section08Rows,
    '### 0.9 新增 / 引用文档登记',
    '- [x] docs',
    '### 0.10 PR / 提交收尾',
    '- [x] PR gate',
    '## 1. 文档定位',
    '',
  ].join('\n');
}

function finalLoadReport(): string {
  return [
    '# Enterprise Acceptance Load Test Report',
    '',
    'Acceptance status: passed',
    '',
    '## Configuration',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    '| Online users | 50 |',
    '| Observed online users | 50 |',
    '| Target running runs | 10 |',
    '| Target pending runs | 5 |',
    '| Max error rate | 1.00% |',
    '| Duration | 300000ms |',
    '| Trace count | 1 |',
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    '| Total HTTP requests | 500 |',
    '| Failed HTTP requests | 0 |',
    '| Error rate | 0.00% |',
    '| Overall p50 | 42ms |',
    '| Overall p95 | 120ms |',
    '| Started analysis runs | 15 |',
    '| Start failures | 0 |',
    '| Started runs missing ids | 0 |',
    '| Max running runs observed | 10 |',
    '| Max queued/pending runs observed | 5 |',
    '| Running-in-range samples | 3 |',
    '| Queued/pending samples | 3 |',
    '| Max queue length | 5 |',
    '| Pre-run runtime baseline | yes |',
    '| Max worker RSS | 256.0 MiB |',
    '| Max lease RSS | 128.0 MiB |',
    '| Initial LLM cost | 0.75 |',
    '| Final LLM cost | 1.23 |',
    '| LLM cost delta | 0.48 |',
    '| Initial LLM calls | 3 |',
    '| Final LLM calls | 4 |',
    '| LLM call delta | 1 |',
    '',
  ].join('\n');
}

function finalRssBenchmark(): string {
  const scenes = ['scroll', 'startup', 'anr', 'memory', 'heapprofd', 'vendor'];
  const sizeBuckets = ['100MB', '500MB', '1GB'];
  const rows = scenes.flatMap(scene =>
    sizeBuckets.map(sizeBucket => [
      `| ${scene}-${sizeBucket}`,
      scene,
      sizeBucket,
      sizeBucket,
      '10ms',
      '100.0 MiB',
      '200.0 MiB',
      '210.0 MiB',
      '10.0 MiB',
      '63.00 GiB',
      'passed |',
    ].join(' | '))
  );

  return [
    '# Trace Processor RSS Benchmark',
    '',
    'Coverage status: complete',
    '',
    '| Trace | Scene | Size bucket | File size | Init | Startup RSS | Load peak | Query peak | Query delta | Query headroom | Status |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows,
    '',
    'Missing required matrix cells:',
    '',
    '- none',
    '',
  ].join('\n');
}

describe('enterprise readiness audit', () => {
  it('parses artifact paths and require-ready mode', () => {
    const cwd = '/tmp/smartperfetto/backend';
    const options = parseEnterpriseReadinessAuditArgs([
      '--readme', '../docs/README.md',
      '--acceptance-evidence', '../docs/acceptance.md',
      '--load-test-report', '../docs/load.md',
      '--rss-benchmark', '../docs/rss.md',
      '--release-notes', '../docs/release.md',
      '--output', 'out/readiness.json',
      '--markdown', 'out/readiness.md',
      '--require-ready',
    ], cwd);

    expect(options).toMatchObject({
      readmePath: path.resolve(cwd, '../docs/README.md'),
      acceptanceEvidencePath: path.resolve(cwd, '../docs/acceptance.md'),
      loadTestReportPath: path.resolve(cwd, '../docs/load.md'),
      rssBenchmarkPath: path.resolve(cwd, '../docs/rss.md'),
      releaseNotesPath: path.resolve(cwd, '../docs/release.md'),
      outputPath: path.resolve(cwd, 'out/readiness.json'),
      markdownPath: path.resolve(cwd, 'out/readiness.md'),
      requireReady: true,
    });
  });

  it('blocks current-style incomplete evidence instead of relying on green tests', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'enterprise-readiness-'));
    try {
      const readmePath = await writeFixture(tmpDir, 'README.md', completeReadme().replace('- [x] §19 item 1', '- [ ] 50 online users'));
      const acceptanceEvidencePath = await writeFixture(tmpDir, 'acceptance.md', '| item | Status | Evidence |\n| load | Open | pending |\n');
      const loadTestReportPath = await writeFixture(tmpDir, 'load.md', 'Status: pending real 50-user run.\n');
      const rssBenchmarkPath = await writeFixture(tmpDir, 'rss.md', 'Coverage status: blocked_missing_required_traces\nMissing required matrix cells:\n- scroll:100MB\n');
      const releaseNotesPath = await writeFixture(tmpDir, 'release.md', 'Status: draft, pending final RSS matrix and 50-user load-test evidence.\n');

      const report = buildEnterpriseReadinessAuditReport({
        readmePath,
        acceptanceEvidencePath,
        loadTestReportPath,
        rssBenchmarkPath,
        releaseNotesPath,
        requireReady: true,
      });

      expect(report.ready).toBe(false);
      expect(report.checks.filter(check => check.status === 'blocked').map(check => check.id)).toEqual([
        'readme-section-0-todos',
        'section-19-acceptance',
        'acceptance-evidence-open-rows',
        'load-test-report-final',
        'rss-benchmark-final',
        'release-notes-final',
      ]);
      expect(determineEnterpriseReadinessAuditExitCode(report, { requireReady: true })).toBe(2);
      expect(buildMarkdownEnterpriseReadinessAudit(report)).toContain('Overall status: blocked');
      expect(report.checks.find(check => check.id === 'pr-closeout-checklist')).toMatchObject({
        status: 'passed',
      });
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('passes only when README §0, D1-D10, §19, and terminal docs are all final', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'enterprise-readiness-'));
    try {
      const readmePath = await writeFixture(tmpDir, 'README.md', completeReadme());
      const acceptanceEvidencePath = await writeFixture(tmpDir, 'acceptance.md', '| item | Status | Evidence |\n| load | Covered | measured |\n');
      const loadTestReportPath = await writeFixture(tmpDir, 'load.md', finalLoadReport());
      const rssBenchmarkPath = await writeFixture(tmpDir, 'rss.md', finalRssBenchmark());
      const releaseNotesPath = await writeFixture(tmpDir, 'release.md', '# Release Notes\nAll final.\n');

      const report = buildEnterpriseReadinessAuditReport({
        readmePath,
        acceptanceEvidencePath,
        loadTestReportPath,
        rssBenchmarkPath,
        releaseNotesPath,
        requireReady: true,
      });

      expect(report.ready).toBe(true);
      expect(report.checks.every(check => check.status === 'passed')).toBe(true);
      expect(determineEnterpriseReadinessAuditExitCode(report, { requireReady: true })).toBe(0);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('requires final load report metrics, not just a passing marker', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'enterprise-readiness-'));
    try {
      const readmePath = await writeFixture(tmpDir, 'README.md', completeReadme());
      const acceptanceEvidencePath = await writeFixture(tmpDir, 'acceptance.md', '| item | Status | Evidence |\n| load | Covered | measured |\n');
      const loadTestReportPath = await writeFixture(tmpDir, 'load.md', 'Acceptance status: passed\n');
      const rssBenchmarkPath = await writeFixture(tmpDir, 'rss.md', finalRssBenchmark());
      const releaseNotesPath = await writeFixture(tmpDir, 'release.md', '# Release Notes\nAll final.\n');

      const report = buildEnterpriseReadinessAuditReport({
        readmePath,
        acceptanceEvidencePath,
        loadTestReportPath,
        rssBenchmarkPath,
        releaseNotesPath,
        requireReady: true,
      });

      expect(report.ready).toBe(false);
      expect(report.checks.find(check => check.id === 'load-test-report-final')).toMatchObject({
        status: 'blocked',
        evidence: expect.arrayContaining([
          'observed online users < 50',
          'missing overall p50',
          'missing worker/lease RSS',
          'LLM call delta <= 0',
        ]),
      });
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects load-test preflight output even if it contains a passing marker', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'enterprise-readiness-'));
    try {
      const readmePath = await writeFixture(tmpDir, 'README.md', completeReadme());
      const acceptanceEvidencePath = await writeFixture(tmpDir, 'acceptance.md', '| item | Status | Evidence |\n| load | Covered | measured |\n');
      const loadTestReportPath = await writeFixture(
        tmpDir,
        'load.md',
        [
          '# Enterprise Acceptance Load Test Preflight',
          'Preflight status: ready',
          'Acceptance status: passed',
          'This preflight does not start analysis runs and is not README §0.8 acceptance evidence.',
        ].join('\n'),
      );
      const rssBenchmarkPath = await writeFixture(tmpDir, 'rss.md', finalRssBenchmark());
      const releaseNotesPath = await writeFixture(tmpDir, 'release.md', '# Release Notes\nAll final.\n');

      const report = buildEnterpriseReadinessAuditReport({
        readmePath,
        acceptanceEvidencePath,
        loadTestReportPath,
        rssBenchmarkPath,
        releaseNotesPath,
        requireReady: true,
      });

      expect(report.ready).toBe(false);
      expect(report.checks.find(check => check.id === 'load-test-report-final')).toMatchObject({
        status: 'blocked',
        evidence: expect.arrayContaining([
          'contains preflight marker',
        ]),
      });
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('requires final RSS matrix rows and metrics, not just a complete marker', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'enterprise-readiness-'));
    try {
      const readmePath = await writeFixture(tmpDir, 'README.md', completeReadme());
      const acceptanceEvidencePath = await writeFixture(tmpDir, 'acceptance.md', '| item | Status | Evidence |\n| load | Covered | measured |\n');
      const loadTestReportPath = await writeFixture(tmpDir, 'load.md', finalLoadReport());
      const rssBenchmarkPath = await writeFixture(tmpDir, 'rss.md', 'Coverage status: complete\n');
      const releaseNotesPath = await writeFixture(tmpDir, 'release.md', '# Release Notes\nAll final.\n');

      const report = buildEnterpriseReadinessAuditReport({
        readmePath,
        acceptanceEvidencePath,
        loadTestReportPath,
        rssBenchmarkPath,
        releaseNotesPath,
        requireReady: true,
      });

      expect(report.ready).toBe(false);
      expect(report.checks.find(check => check.id === 'rss-benchmark-final')).toMatchObject({
        status: 'blocked',
        evidence: expect.arrayContaining([
          'missing RSS matrix cell scroll:100MB',
          'missing RSS matrix cell vendor:1GB',
        ]),
      });
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('requires query headroom in final RSS benchmark rows', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'enterprise-readiness-'));
    try {
      const readmePath = await writeFixture(tmpDir, 'README.md', completeReadme());
      const acceptanceEvidencePath = await writeFixture(tmpDir, 'acceptance.md', '| item | Status | Evidence |\n| load | Covered | measured |\n');
      const loadTestReportPath = await writeFixture(tmpDir, 'load.md', finalLoadReport());
      const rssBenchmarkPath = await writeFixture(
        tmpDir,
        'rss.md',
        finalRssBenchmark().replace(/63\.00 GiB/g, 'n/a'),
      );
      const releaseNotesPath = await writeFixture(tmpDir, 'release.md', '# Release Notes\nAll final.\n');

      const report = buildEnterpriseReadinessAuditReport({
        readmePath,
        acceptanceEvidencePath,
        loadTestReportPath,
        rssBenchmarkPath,
        releaseNotesPath,
        requireReady: true,
      });

      expect(report.ready).toBe(false);
      expect(report.checks.find(check => check.id === 'rss-benchmark-final')).toMatchObject({
        status: 'blocked',
        evidence: expect.arrayContaining([
          'RSS cell scroll:100MB missing query headroom',
          'RSS cell vendor:1GB missing query headroom',
        ]),
      });
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects RSS candidate audit output even if it contains a complete marker', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'enterprise-readiness-'));
    try {
      const readmePath = await writeFixture(tmpDir, 'README.md', completeReadme());
      const acceptanceEvidencePath = await writeFixture(tmpDir, 'acceptance.md', '| item | Status | Evidence |\n| load | Covered | measured |\n');
      const loadTestReportPath = await writeFixture(tmpDir, 'load.md', finalLoadReport());
      const rssBenchmarkPath = await writeFixture(
        tmpDir,
        'rss.md',
        [
          '# Trace Processor RSS Matrix Candidate Audit',
          'This audit only checks candidate trace availability. It is not RSS benchmark evidence.',
          'Coverage status: complete',
          'Missing required matrix cells:',
          '- none',
        ].join('\n'),
      );
      const releaseNotesPath = await writeFixture(tmpDir, 'release.md', '# Release Notes\nAll final.\n');

      const report = buildEnterpriseReadinessAuditReport({
        readmePath,
        acceptanceEvidencePath,
        loadTestReportPath,
        rssBenchmarkPath,
        releaseNotesPath,
        requireReady: true,
      });

      expect(report.ready).toBe(false);
      expect(report.checks.find(check => check.id === 'rss-benchmark-final')).toMatchObject({
        status: 'blocked',
        evidence: expect.arrayContaining([
          'contains candidate-audit marker',
        ]),
      });
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('requires all ten D1-D10 rows, not just a checked §0 summary', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'enterprise-readiness-'));
    try {
      const readmePath = await writeFixture(tmpDir, 'README.md', completeReadme().replace('- [x] D10 scenario\n', ''));
      const acceptanceEvidencePath = await writeFixture(tmpDir, 'acceptance.md', '| item | Status | Evidence |\n| load | Covered | measured |\n');
      const loadTestReportPath = await writeFixture(tmpDir, 'load.md', finalLoadReport());
      const rssBenchmarkPath = await writeFixture(tmpDir, 'rss.md', finalRssBenchmark());
      const releaseNotesPath = await writeFixture(tmpDir, 'release.md', '# Release Notes\nAll final.\n');

      const report = buildEnterpriseReadinessAuditReport({
        readmePath,
        acceptanceEvidencePath,
        loadTestReportPath,
        rssBenchmarkPath,
        releaseNotesPath,
        requireReady: true,
      });

      expect(report.ready).toBe(false);
      expect(report.checks.find(check => check.id === 'd1-d10-automated-regression')).toMatchObject({
        status: 'blocked',
      });
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports PR closeout blockers separately from measured-evidence blockers', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'enterprise-readiness-'));
    try {
      const readmePath = await writeFixture(
        tmpDir,
        'README.md',
        completeReadme()
          .replace('- [x] §19 item 1', '- [ ] 50 online users')
          .replace('- [x] PR gate', '- [ ] PR Gate `npm run verify:pr` 通过'),
      );
      const acceptanceEvidencePath = await writeFixture(tmpDir, 'acceptance.md', '| item | Status | Evidence |\n| load | Open | pending |\n');
      const loadTestReportPath = await writeFixture(tmpDir, 'load.md', 'Status: pending real 50-user run.\n');
      const rssBenchmarkPath = await writeFixture(tmpDir, 'rss.md', 'Coverage status: blocked_missing_required_traces\nMissing required matrix cells:\n- scroll:100MB\n');
      const releaseNotesPath = await writeFixture(tmpDir, 'release.md', 'Status: draft, pending final RSS matrix and 50-user load-test evidence.\n');

      const report = buildEnterpriseReadinessAuditReport({
        readmePath,
        acceptanceEvidencePath,
        loadTestReportPath,
        rssBenchmarkPath,
        releaseNotesPath,
        requireReady: true,
      });

      expect(report.checks.find(check => check.id === 'readme-section-0-todos')).toMatchObject({
        status: 'blocked',
      });
      expect(report.checks.find(check => check.id === 'pr-closeout-checklist')).toMatchObject({
        status: 'blocked',
        evidence: expect.arrayContaining([
          expect.stringContaining('PR Gate `npm run verify:pr` 通过'),
        ]),
      });
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
