/**
 * Strategy Helper Functions
 *
 * Utility functions used by strategy implementations for interval extraction.
 * These were extracted from the orchestrator to be shared across strategies.
 */

import { IntervalHelpers } from './types';

/**
 * Convert columnar payload ({ columns, rows }) or array-of-objects to
 * a normalized array of row objects.
 *
 * Handles three formats:
 * 1. Already an array of objects → passthrough
 * 2. { columns: string[], rows: any[][] } → zip into objects
 * 3. Anything else → empty array
 */
export function payloadToObjectRows(payload: any): Array<Record<string, any>> {
  if (!payload) return [];

  // Already array of objects
  if (Array.isArray(payload) && payload.length > 0 && typeof payload[0] === 'object' && !Array.isArray(payload[0])) {
    return payload as Array<Record<string, any>>;
  }

  // Columnar format
  const columns: string[] | undefined = payload.columns;
  const rows: any[][] | undefined = payload.rows;
  if (!Array.isArray(columns) || !Array.isArray(rows)) return [];

  return rows.map((row) => {
    const obj: Record<string, any> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]] = row[i];
    }
    return obj;
  });
}

/**
 * Heuristic to determine if a process name is likely an app process
 * (as opposed to a system daemon like surfaceflinger or system_server).
 */
export function isLikelyAppProcessName(name: string): boolean {
  const n = (name || '').trim();
  if (!n) return false;
  if (n.startsWith('/')) return false; // e.g. /system/bin/surfaceflinger
  if (n.includes('surfaceflinger')) return false;
  if (n === 'system_server') return false;
  return true;
}

/**
 * Format a nanosecond time range as a human-readable "Xs–Ys" label.
 * Uses BigInt division for precision-safe conversion from ns to seconds.
 */
export function formatNsRangeLabel(startTs: string | number, endTs: string | number): string {
  try {
    const startBi = BigInt(String(startTs));
    const endBi = BigInt(String(endTs));
    // ns → ms (BigInt) → s (Number, safe range)
    const startS = Number(startBi / 1000000n) / 1000;
    const endS = Number(endBi / 1000000n) / 1000;
    return `${startS.toFixed(2)}s–${endS.toFixed(2)}s`;
  } catch {
    // Fallback for non-BigInt-compatible values
    const startS = (Number(startTs) / 1e9).toFixed(2);
    const endS = (Number(endTs) / 1e9).toFixed(2);
    return `${startS}s–${endS}s`;
  }
}

/**
 * Pre-built helpers instance for use in strategy extractIntervals implementations.
 */
export const intervalHelpers: IntervalHelpers = {
  payloadToObjectRows,
  isLikelyAppProcessName,
  formatNsRangeLabel,
};
