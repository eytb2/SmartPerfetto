// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

const DEFAULT_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
const MIN_UPLOAD_BYTES = 16 * 1024 * 1024;
export const TRACE_UPLOAD_MAX_BYTES_ENV = 'SMARTPERFETTO_TRACE_UPLOAD_MAX_BYTES';

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveTraceUploadLimitBytes(env: NodeJS.ProcessEnv = process.env): number {
  const configured = parsePositiveInteger(env[TRACE_UPLOAD_MAX_BYTES_ENV]);
  if (configured) {
    return Math.max(configured, MIN_UPLOAD_BYTES);
  }
  return DEFAULT_UPLOAD_BYTES;
}
