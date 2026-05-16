// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type { TraceProcessorService } from '../services/traceProcessorService';

export interface DetectedFocusApp {
  packageName: string;
  totalDurationNs: number;
  switchCount: number;
}

export interface FocusAppDetectionResult {
  apps: DetectedFocusApp[];
  primaryApp?: string;
  method: 'battery_stats' | 'oom_adj' | 'frame_timeline' | 'none';
}

// System processes to exclude — they're often foreground context, not user apps.
const SYSTEM_PROCESS_EXACT = new Set([
  'init',
  'surfaceflinger',
  'system_server',
  'zygote',
  'zygote64',
]);

const SYSTEM_PROCESS_PREFIXES = [
  '/system/bin/',
  '/system_ext/bin/',
  '/vendor/bin/',
  '/odm/bin/',
  '/apex/',
];

const SYSTEM_PACKAGE_PREFIXES = [
  'com.android.systemui',
  'com.android.launcher',
  'com.android.phone',
  'com.android.providers',
  // Google system apps that frequently appear in foreground but are rarely analysis targets
  'com.google.android.inputmethod',   // Gboard
  'com.google.android.apps.nexuslauncher', // Pixel Launcher
  'com.android.inputmethod',          // AOSP keyboard
  'com.google.android.apps.wallpaper', // Wallpaper picker
  'com.miui.home',                    // Xiaomi launcher
  'com.huawei.android.launcher',       // Huawei launcher
  'com.oppo.launcher',                // OPPO launcher
  'com.vivo.launcher',                // Vivo launcher
  'com.sec.android.app.launcher',      // Samsung launcher
];

function isSystemProcess(name: string): boolean {
  const lower = name.toLowerCase();
  return SYSTEM_PROCESS_EXACT.has(lower) ||
    SYSTEM_PROCESS_PREFIXES.some(prefix => lower.startsWith(prefix)) ||
    SYSTEM_PACKAGE_PREFIXES.some(prefix =>
      lower === prefix ||
      lower.startsWith(`${prefix}.`) ||
      lower.startsWith(`${prefix}:`));
}

/**
 * Detect foreground ("focus") apps from a Perfetto trace using cross-source SQL.
 *
 * Tier 1: android_battery_stats_event_slices — most reliable, tracks `battery_stats.top`
 * Tier 2: android_oom_adj_intervals — fallback, score <= 0 means foreground
 * Tier 3: FrameTimeline upid/layer evidence — useful when focus stats are absent
 */
export async function detectFocusApps(
  traceProcessorService: TraceProcessorService,
  traceId: string,
): Promise<FocusAppDetectionResult> {
  // Tier 1: battery_stats.top
  try {
    const result = await traceProcessorService.query(traceId, `
        INCLUDE PERFETTO MODULE android.battery_stats;
        SELECT
          str_value AS package_name,
          SUM(safe_dur) AS total_duration_ns,
          COUNT(*) AS switch_count
        FROM android_battery_stats_event_slices
        WHERE track_name = 'battery_stats.top'
          AND safe_dur > 50000000
        GROUP BY str_value
        ORDER BY total_duration_ns DESC
        LIMIT 10
      `);

    if (result.rows.length > 0) {
      const apps = result.rows
        .map(row => ({
          packageName: String(row[0]),
          totalDurationNs: Number(row[1]),
          switchCount: Number(row[2]),
        }))
        .filter(app => !isSystemProcess(app.packageName));

      if (apps.length > 0) {
        return {
          apps,
          primaryApp: apps[0].packageName,
          method: 'battery_stats',
        };
      }
    }
  } catch (err) {
    console.warn('[FocusAppDetector] Tier 1 (battery_stats) failed:', (err as Error).message);
  }

  // Tier 2: oom_adj intervals (score <= 0 = foreground). Prefer Android
  // package metadata over raw process.name; process.name can be stale/truncated.
  try {
    const result = await traceProcessorService.query(traceId, `
        INCLUDE PERFETTO MODULE android.oom_adjuster;
        INCLUDE PERFETTO MODULE android.process_metadata;
        WITH foreground_intervals AS (
          SELECT
            COALESCE(
              NULLIF(m.package_name, ''),
              NULLIF(m.process_name, ''),
              NULLIF(p.cmdline, ''),
              p.name
            ) AS package_name,
            oa.dur
          FROM android_oom_adj_intervals oa
          JOIN process p USING(upid)
          LEFT JOIN android_process_metadata m USING(upid)
          WHERE oa.score <= 0 AND oa.score > -900
        )
        SELECT
          package_name,
          SUM(dur) AS total_duration_ns,
          COUNT(*) AS switch_count
        FROM foreground_intervals
        WHERE package_name IS NOT NULL
          AND package_name != ''
        GROUP BY package_name
        ORDER BY total_duration_ns DESC
        LIMIT 10
      `);

    if (result.rows.length > 0) {
      const apps = result.rows
        .map(row => ({
          packageName: String(row[0]),
          totalDurationNs: Number(row[1]),
          switchCount: Number(row[2]),
        }))
        .filter(app => !isSystemProcess(app.packageName));

      if (apps.length > 0) {
        return {
          apps,
          primaryApp: apps[0].packageName,
          method: 'oom_adj',
        };
      }
    }
  } catch (err) {
    console.warn('[FocusAppDetector] Tier 2 (oom_adj) failed:', (err as Error).message);
  }

  // Tier 3: FrameTimeline upid/layer evidence (always present when frames exist)
  // layer_name format: "TX - com.example.app/com.example.app.Activity#1234"
  try {
    const result = await traceProcessorService.query(traceId, `
        INCLUDE PERFETTO MODULE android.frames.timeline;
        INCLUDE PERFETTO MODULE android.process_metadata;
        WITH frame_packages AS (
          SELECT
            COALESCE(
              NULLIF(m.package_name, ''),
              CASE
                WHEN layer_name LIKE 'TX - %/%'
                  THEN SUBSTR(layer_name, 6, INSTR(SUBSTR(layer_name, 6), '/') - 1)
                WHEN layer_name LIKE 'TX - %'
                  THEN SUBSTR(layer_name, 6)
                ELSE NULL
              END,
              NULLIF(m.process_name, ''),
              NULLIF(p.cmdline, ''),
              p.name
            ) AS package_name,
            a.dur
          FROM actual_frame_timeline_slice a
          LEFT JOIN process p USING(upid)
          LEFT JOIN android_process_metadata m USING(upid)
          WHERE layer_name IS NOT NULL AND layer_name != ''
        )
        SELECT
          package_name,
          SUM(dur) AS total_duration_ns,
          COUNT(*) AS frame_count
        FROM frame_packages
        WHERE package_name IS NOT NULL AND package_name != ''
        GROUP BY package_name
        ORDER BY frame_count DESC
        LIMIT 10
      `);

    if (result.rows.length > 0) {
      const apps = result.rows
        .map(row => ({
          packageName: String(row[0]),
          totalDurationNs: Number(row[1]),
          switchCount: Number(row[2]),
        }))
        .filter(app => app.packageName && !isSystemProcess(app.packageName));

      if (apps.length > 0) {
        return {
          apps,
          primaryApp: apps[0].packageName,
          method: 'frame_timeline',
        };
      }
    }
  } catch (err) {
    console.warn('[FocusAppDetector] Tier 3 (frame_timeline) failed:', (err as Error).message);
  }

  return { apps: [], method: 'none' };
}

/** Human-readable duration for system prompt (e.g. "2.3s", "145ms") */
export function formatDurationNs(ns: number): string {
  if (ns >= 1_000_000_000) return `${(ns / 1_000_000_000).toFixed(1)}s`;
  if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(0)}ms`;
  return `${(ns / 1_000).toFixed(0)}us`;
}
