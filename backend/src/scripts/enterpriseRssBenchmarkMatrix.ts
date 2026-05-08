// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

export const REQUIRED_RSS_BENCHMARK_SCENES = [
  'scroll',
  'startup',
  'anr',
  'memory',
  'heapprofd',
  'vendor',
] as const;

export const REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS = [
  '100MB',
  '500MB',
  '1GB',
] as const;

export type RequiredScene = typeof REQUIRED_RSS_BENCHMARK_SCENES[number];
export type RequiredSizeBucket = typeof REQUIRED_RSS_BENCHMARK_SIZE_BUCKETS[number];
export type SizeBucket = RequiredSizeBucket | 'under-100MB';
