// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fs from 'fs';
import { spawnSync } from 'child_process';

export interface ProcessRssSample {
  pid: number;
  rssBytes: number | null;
  source: 'procfs' | 'ps' | 'unavailable';
  error?: string;
}

export function parseProcStatusRssBytes(statusText: string): number | null {
  const match = statusText.match(/^VmRSS:\s+(\d+)\s+kB\s*$/m);
  if (!match) return null;
  const kib = Number.parseInt(match[1], 10);
  return Number.isFinite(kib) ? kib * 1024 : null;
}

export function parsePsRssBytes(psOutput: string): number | null {
  const firstLine = psOutput.trim().split(/\r?\n/).find(Boolean);
  if (!firstLine) return null;
  const kib = Number.parseInt(firstLine.trim(), 10);
  return Number.isFinite(kib) ? kib * 1024 : null;
}

export function readProcessRssBytes(pid: number): ProcessRssSample {
  if (!Number.isInteger(pid) || pid <= 0) {
    return {
      pid,
      rssBytes: null,
      source: 'unavailable',
      error: 'pid must be a positive integer',
    };
  }

  const procStatusPath = `/proc/${pid}/status`;
  if (fs.existsSync(procStatusPath)) {
    try {
      const parsed = parseProcStatusRssBytes(fs.readFileSync(procStatusPath, 'utf8'));
      if (parsed !== null) {
        return {
          pid,
          rssBytes: parsed,
          source: 'procfs',
        };
      }
    } catch (error: any) {
      return {
        pid,
        rssBytes: null,
        source: 'unavailable',
        error: error.message,
      };
    }
  }

  const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 2000,
  });
  const parsed = parsePsRssBytes(result.stdout ?? '');
  if (parsed !== null) {
    return {
      pid,
      rssBytes: parsed,
      source: 'ps',
    };
  }

  const stderr = `${result.stderr ?? ''}`.trim();
  return {
    pid,
    rssBytes: null,
    source: 'unavailable',
    ...(stderr ? { error: stderr } : {}),
  };
}
