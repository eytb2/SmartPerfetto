// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  runEnterpriseWindowRegression,
  type EnterpriseWindowRegressionReport,
} from '../verifyEnterpriseMultiTenantWindows';

describe('verifyEnterpriseMultiTenantWindows script', () => {
  let tempRoot: string;
  let previousUploadDir: string | undefined;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-window-regression-test-'));
    previousUploadDir = process.env.UPLOAD_DIR;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    if (previousUploadDir === undefined) {
      delete process.env.UPLOAD_DIR;
    } else {
      process.env.UPLOAD_DIR = previousUploadDir;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test('covers current D1/D2 isolation invariants without invoking a real provider', async () => {
    const tracePath = path.join(tempRoot, 'fixture.pftrace');
    const uploadRoot = path.join(tempRoot, 'uploads');
    const outputPath = path.join(tempRoot, 'report.json');
    await fs.writeFile(tracePath, 'fake perfetto trace bytes');

    const report = await runEnterpriseWindowRegression({
      tracePath,
      uploadRoot,
      outputPath,
      longSqlMs: 20,
    });

    expect(report.passed).toBe(true);
    expect(report.checks).toEqual({ D1: true, D2: true });
    expect(Object.values(report.scenarios.D1.checks)).toEqual(expect.arrayContaining([true]));
    expect(Object.values(report.scenarios.D1.checks).every(Boolean)).toBe(true);
    expect(Object.values(report.scenarios.D2.checks).every(Boolean)).toBe(true);
    expect(report.coverageLimitations.join('\n')).toContain('TraceProcessorLease');
    expect(process.env.UPLOAD_DIR).toBe(previousUploadDir);

    const written = JSON.parse(await fs.readFile(outputPath, 'utf8')) as EnterpriseWindowRegressionReport;
    expect(written.passed).toBe(true);
    expect(written.checks).toEqual(report.checks);

    const traceFiles = (await fs.readdir(path.join(uploadRoot, 'traces')))
      .filter(file => file.endsWith('.trace'));
    expect(traceFiles).toHaveLength(6);
  });
});
