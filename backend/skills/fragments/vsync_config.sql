-- Fragment: vsync_config
-- Estimates VSync period using IQR-filtered mean for VRR robustness, fallback to 16.67ms (60Hz)
-- Params: ${start_ts}, ${end_ts}
vsync_ticks AS (
  SELECT c.ts, c.ts - LAG(c.ts) OVER (ORDER BY c.ts) as interval_ns
  FROM counter c
  JOIN counter_track t ON c.track_id = t.id
  WHERE t.name = 'VSYNC-sf'
    AND c.ts >= ${start_ts} - 100000000
    AND c.ts < ${end_ts} + 100000000
),
vsync_ticks_ranked AS (
  SELECT interval_ns, PERCENT_RANK() OVER (ORDER BY interval_ns) AS pct
  FROM vsync_ticks
  WHERE interval_ns > 4000000 AND interval_ns < 50000000
),
vsync_config AS (
  SELECT CAST(COALESCE(
    (SELECT AVG(interval_ns) FROM vsync_ticks_ranked WHERE pct BETWEEN 0.25 AND 0.75),
    16666667
  ) AS INTEGER) as vsync_period_ns
)
