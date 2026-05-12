// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type {
  ComparisonDelta,
  ComparisonMatrixRow,
  NormalizedMetricValue,
} from '../types/multiTraceComparison';

const RELATIVE_DELTA_THRESHOLD_PCT = 5;

const ABSOLUTE_DELTA_THRESHOLD_BY_UNIT: Partial<Record<NonNullable<NormalizedMetricValue['unit']>, number>> = {
  ms: 5,
  fps: 1,
  '%': 1,
  count: 1,
  bytes: 1024 * 1024,
  ns: 5_000_000,
};

export function isSignificantComparisonDelta(
  delta: ComparisonDelta,
  row?: Pick<ComparisonMatrixRow, 'unit'>,
): boolean {
  if (
    delta.deltaValue === null ||
    delta.assessment === 'same' ||
    delta.assessment === 'unknown'
  ) {
    return false;
  }

  const absDeltaValue = Math.abs(delta.deltaValue);
  const absDeltaPct =
    typeof delta.deltaPct === 'number' && Number.isFinite(delta.deltaPct)
      ? Math.abs(delta.deltaPct)
      : null;
  const unit = row?.unit;
  const absoluteThreshold = unit ? ABSOLUTE_DELTA_THRESHOLD_BY_UNIT[unit] : undefined;

  if (absoluteThreshold !== undefined) {
    const passesAbsoluteThreshold = absDeltaValue >= absoluteThreshold;
    if (unit === '%' || unit === 'count') {
      return passesAbsoluteThreshold ||
        (absDeltaPct !== null && absDeltaPct >= RELATIVE_DELTA_THRESHOLD_PCT);
    }
    return passesAbsoluteThreshold &&
      (absDeltaPct === null || absDeltaPct >= RELATIVE_DELTA_THRESHOLD_PCT);
  }

  if (absDeltaPct !== null) {
    return absDeltaPct >= RELATIVE_DELTA_THRESHOLD_PCT;
  }
  return absDeltaValue > 1e-9;
}
