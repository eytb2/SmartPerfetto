// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { ENTERPRISE_FEATURE_FLAG_ENV } from '../../config';
import {
  TP_ADMISSION_CONTROL_ENV,
  TP_ESTIMATE_MULTIPLIER_ENV,
  TP_MIN_ESTIMATE_BYTES_ENV,
  TP_RAM_BUDGET_BYTES_ENV,
  decideTraceProcessorAdmission,
  estimateTraceProcessorRssBytes,
  getTraceProcessorRamBudgetStats,
  resolveTraceProcessorMachineFactor,
  traceProcessorAdmissionEnabled,
} from '../traceProcessorRamBudget';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

describe('trace processor RAM budget', () => {
  it('uses machine-size factors unless explicitly configured', () => {
    expect(resolveTraceProcessorMachineFactor(8 * GIB, env({}))).toBe(0.60);
    expect(resolveTraceProcessorMachineFactor(16 * GIB, env({}))).toBe(0.75);
    expect(resolveTraceProcessorMachineFactor(64 * GIB, env({}))).toBe(0.85);
  });

  it('estimates RSS from trace size with a configurable floor', () => {
    const options = env({
      [TP_ESTIMATE_MULTIPLIER_ENV]: '2',
      [TP_MIN_ESTIMATE_BYTES_ENV]: String(256 * MIB),
    });

    expect(estimateTraceProcessorRssBytes(64 * MIB, options)).toBe(256 * MIB);
    expect(estimateTraceProcessorRssBytes(200 * MIB, options)).toBe(400 * MIB);
  });

  it('defaults admission control to the enterprise feature flag', () => {
    expect(traceProcessorAdmissionEnabled(env({ [ENTERPRISE_FEATURE_FLAG_ENV]: 'false' }))).toBe(false);
    expect(traceProcessorAdmissionEnabled(env({ [ENTERPRISE_FEATURE_FLAG_ENV]: 'true' }))).toBe(true);
    expect(traceProcessorAdmissionEnabled(env({
      [ENTERPRISE_FEATURE_FLAG_ENV]: 'true',
      [TP_ADMISSION_CONTROL_ENV]: 'false',
    }))).toBe(false);
  });

  it('subtracts observed processor RSS from explicit RAM budget', () => {
    const stats = getTraceProcessorRamBudgetStats(
      [
        { traceId: 'trace-a', rssBytes: 128 * MIB },
        { traceId: 'trace-b', rssBytes: null },
      ],
      env({
        [TP_ADMISSION_CONTROL_ENV]: 'true',
        [TP_RAM_BUDGET_BYTES_ENV]: String(512 * MIB),
      }),
    );

    expect(stats.enabled).toBe(true);
    expect(stats.budgetBytes).toBe(512 * MIB);
    expect(stats.observedProcessorRssBytes).toBe(128 * MIB);
    expect(stats.availableForNewLeaseBytes).toBe(384 * MIB);
    expect(stats.activeProcessorCount).toBe(2);
    expect(stats.unknownRssProcessorCount).toBe(1);
  });

  it('rejects a new trace when the estimate exceeds the remaining budget', () => {
    const decision = decideTraceProcessorAdmission({
      traceId: 'trace-large',
      traceSizeBytes: 200 * MIB,
      processors: [{ traceId: 'trace-a', rssBytes: 400 * MIB }],
      env: env({
        [TP_ADMISSION_CONTROL_ENV]: 'true',
        [TP_RAM_BUDGET_BYTES_ENV]: String(512 * MIB),
        [TP_ESTIMATE_MULTIPLIER_ENV]: '1',
        [TP_MIN_ESTIMATE_BYTES_ENV]: String(64 * MIB),
      }),
    });

    expect(decision.admitted).toBe(false);
    expect(decision.estimatedRssBytes).toBe(200 * MIB);
    expect(decision.stats.availableForNewLeaseBytes).toBe(112 * MIB);
    expect(decision.reason).toContain('exceeds available budget');
  });
});
