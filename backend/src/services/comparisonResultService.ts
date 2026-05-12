// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type {
  AnalysisResultSnapshot,
  ComparisonDelta,
  ComparisonMatrix,
  ComparisonMetricKey,
  ComparisonResult,
} from '../types/multiTraceComparison';
import { buildComparisonMatrix } from './comparisonMatrixService';

export const DEFAULT_COMPARISON_METRIC_KEYS: readonly ComparisonMetricKey[] = [
  'startup.total_ms',
  'scrolling.avg_fps',
  'scrolling.jank_rate_pct',
] as const;

export interface BuildDeterministicComparisonResultOptions {
  baselineSnapshotId: string;
  metricKeys?: ComparisonMetricKey[];
}

export function resolveComparisonMetricKeys(
  requestedMetricKeys: ComparisonMetricKey[] | undefined,
): ComparisonMetricKey[] {
  const requested = requestedMetricKeys
    ?.map(metricKey => metricKey.trim())
    .filter(Boolean) as ComparisonMetricKey[] | undefined;
  const uniqueRequested = requested ? [...new Set(requested)] : [];
  return uniqueRequested.length > 0
    ? uniqueRequested
    : [...DEFAULT_COMPARISON_METRIC_KEYS];
}

function collectSignificantChanges(matrix: ComparisonMatrix): ComparisonDelta[] {
  return matrix.rows
    .flatMap(row => row.deltas)
    .filter(delta =>
      delta.deltaValue !== null &&
      delta.assessment !== 'same' &&
      delta.assessment !== 'unknown')
    .sort((a, b) => {
      const assessmentWeight = (assessment: ComparisonDelta['assessment']): number =>
        assessment === 'worse' ? 0 : assessment === 'better' ? 1 : 2;
      const assessmentDiff = assessmentWeight(a.assessment) - assessmentWeight(b.assessment);
      if (assessmentDiff !== 0) return assessmentDiff;
      const aMagnitude = Math.abs(a.deltaPct ?? a.deltaValue ?? 0);
      const bMagnitude = Math.abs(b.deltaPct ?? b.deltaValue ?? 0);
      return bMagnitude - aMagnitude;
    });
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, '');
}

function formatDelta(delta: ComparisonDelta, matrix: ComparisonMatrix): string {
  const row = matrix.rows.find(item => item.metricKey === delta.metricKey);
  const label = row?.label || delta.metricKey;
  const unit = row?.unit ? ` ${row.unit}` : '';
  const pct = delta.deltaPct === null ? '' : ` (${formatNumber(delta.deltaPct)}%)`;
  return `${label} changed by ${formatNumber(delta.deltaValue ?? 0)}${unit}${pct} for ${delta.snapshotId} vs ${delta.baselineSnapshotId}; assessment=${delta.assessment}.`;
}

function buildUncertainty(matrix: ComparisonMatrix): string[] {
  const missing = Object.entries(matrix.missingMatrix).flatMap(([snapshotId, metrics]) =>
    Object.keys(metrics).map(metricKey => `${snapshotId} is missing metric ${metricKey}.`));
  return [...matrix.warnings, ...missing];
}

export function buildDeterministicComparisonResult(
  snapshots: AnalysisResultSnapshot[],
  options: BuildDeterministicComparisonResultOptions,
): ComparisonResult {
  const metricKeys = resolveComparisonMetricKeys(options.metricKeys);
  const matrix = buildComparisonMatrix(snapshots, {
    baselineSnapshotId: options.baselineSnapshotId,
    metricKeys,
  });
  const significantChanges = collectSignificantChanges(matrix);
  return {
    matrix,
    significantChanges,
    conclusion: {
      source: 'deterministic',
      generatedAt: Date.now(),
      verifiedFacts: significantChanges.map(delta => formatDelta(delta, matrix)),
      inferences: [],
      recommendations: [],
      uncertainty: buildUncertainty(matrix),
    },
  };
}
