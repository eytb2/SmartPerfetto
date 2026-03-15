-- Fragment: vsync_config
-- Estimates VSync period using median of VSYNC-sf intervals, fallback to 16.67ms (60Hz)
-- Params: ${start_ts}, ${end_ts}
vsync_ticks AS (
  SELECT c.ts, c.ts - LAG(c.ts) OVER (ORDER BY c.ts) as interval_ns
  FROM counter c
  JOIN counter_track t ON c.track_id = t.id
  WHERE t.name = 'VSYNC-sf'
    AND c.ts >= ${start_ts} - 100000000
    AND c.ts < ${end_ts} + 100000000
),
vsync_config AS (
  SELECT CAST(COALESCE(
    (SELECT PERCENTILE(interval_ns, 0.5)
     FROM vsync_ticks
     WHERE interval_ns > 4000000 AND interval_ns < 50000000),
    16666667
  ) AS INTEGER) as vsync_period_ns
)
