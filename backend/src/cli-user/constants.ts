// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * CLI-wide constants that multiple call sites would otherwise hard-code.
 * Kept deliberately small — this file is not a home for config, just for
 * literals that need exactly one source of truth.
 */

/** Default first-turn question used when the user calls `analyze` / REPL `/load`
 *  without providing `--query`. Intentionally open-ended so the skill router
 *  picks the right scene classifier path. */
export const DEFAULT_ANALYSIS_QUERY = '分析这个 trace 的性能问题，找出根因';
