-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2024-2026 Gracker (Chris)
-- This file is part of SmartPerfetto. See LICENSE for details.
--
-- smartperfetto.scrolling.jank_frames
--
-- Janky-frame extraction view anchored on FrameTimeline ground truth
-- (Spark #16). Returns one row per janky frame with the canonical
-- attribution dimensions used by the scrolling decision tree.
--
-- Codex review caught that actual_frame_timeline_slice does not expose
-- process_name or expected_dur directly — they live on the `process`
-- table (joined via upid) and on `expected_frame_timeline_slice`
-- (joined via frame token = name). This rewrite does both joins so the
-- view succeeds at include/query time.

INCLUDE PERFETTO MODULE android.frames.timeline;

CREATE PERFETTO VIEW smartperfetto_scrolling_jank_frames AS
SELECT
  CAST(actual.name AS INTEGER) AS frame_id,
  actual.ts AS start_ts,
  actual.dur AS dur_ns,
  actual.ts + actual.dur AS end_ts,
  actual.jank_type,
  process.name AS process_name,
  actual.layer_name,
  expected.dur AS expected_dur_ns,
  CASE
    WHEN actual.jank_type IS NULL OR actual.jank_type = 'None' THEN 0
    ELSE 1
  END AS is_jank
FROM actual_frame_timeline_slice AS actual
LEFT JOIN process USING (upid)
LEFT JOIN expected_frame_timeline_slice AS expected
  ON expected.upid = actual.upid AND expected.name = actual.name
WHERE actual.jank_type IS NOT NULL AND actual.jank_type != 'None';
