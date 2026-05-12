// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import {
  ANALYSIS_RESULT_SNAPSHOT_SCHEMA_VERSION,
  type AnalysisResultSnapshot,
} from '../../types/multiTraceComparison';
import { buildComparisonMatrix } from '../comparisonMatrixService';

function snapshot(
  id: string,
  metricValues: {
    startupMs?: number;
    fps?: number;
    jankRate?: number;
  },
): AnalysisResultSnapshot {
  return {
    id,
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    traceId: `trace-${id}`,
    sessionId: `session-${id}`,
    runId: `run-${id}`,
    createdBy: 'user-a',
    visibility: 'workspace',
    sceneType: 'startup',
    title: id,
    userQuery: 'analyze',
    traceLabel: id,
    traceMetadata: {},
    summary: { headline: 'ok' },
    metrics: [
      metricValues.startupMs === undefined ? undefined : {
        key: 'startup.total_ms',
        label: 'Startup total duration',
        group: 'startup',
        value: metricValues.startupMs,
        unit: 'ms',
        direction: 'lower_is_better',
        aggregation: 'single',
        confidence: 0.9,
        source: { type: 'skill', dataEnvelopeId: `env-${id}-startup` },
      },
      metricValues.fps === undefined ? undefined : {
        key: 'scrolling.avg_fps',
        label: 'Average FPS',
        group: 'fps',
        value: metricValues.fps,
        unit: 'fps',
        direction: 'higher_is_better',
        aggregation: 'avg',
        confidence: 0.8,
        source: { type: 'skill', dataEnvelopeId: `env-${id}-fps` },
      },
      metricValues.jankRate === undefined ? undefined : {
        key: 'scrolling.jank_rate_pct',
        label: 'Jank rate',
        group: 'jank',
        value: metricValues.jankRate,
        unit: '%',
        direction: 'lower_is_better',
        aggregation: 'avg',
        confidence: 0.8,
        source: { type: 'skill', dataEnvelopeId: `env-${id}-jank` },
      },
    ].filter(Boolean) as AnalysisResultSnapshot['metrics'],
    evidenceRefs: [],
    status: 'ready',
    schemaVersion: ANALYSIS_RESULT_SNAPSHOT_SCHEMA_VERSION,
    createdAt: 1_700_000_000_000,
  };
}

describe('buildComparisonMatrix', () => {
  test('builds rows and deltas for startup/fps/jank metrics', () => {
    const matrix = buildComparisonMatrix(
      [
        snapshot('baseline', { startupMs: 1200, fps: 55, jankRate: 8 }),
        snapshot('candidate', { startupMs: 900, fps: 60, jankRate: 3 }),
      ],
      {
        baselineSnapshotId: 'baseline',
        metricKeys: [
          'startup.total_ms',
          'scrolling.avg_fps',
          'scrolling.jank_rate_pct',
        ],
      },
    );

    expect(matrix.baselineSnapshotId).toBe('baseline');
    expect(matrix.rows.map(row => row.metricKey)).toEqual([
      'startup.total_ms',
      'scrolling.avg_fps',
      'scrolling.jank_rate_pct',
    ]);

    const startup = matrix.rows.find(row => row.metricKey === 'startup.total_ms')!;
    expect(startup.baseline?.numericValue).toBe(1200);
    expect(startup.deltas[0]).toMatchObject({
      snapshotId: 'candidate',
      deltaValue: -300,
      deltaPct: -25,
      assessment: 'better',
    });

    const fps = matrix.rows.find(row => row.metricKey === 'scrolling.avg_fps')!;
    expect(fps.deltas[0]).toMatchObject({
      deltaValue: 5,
      assessment: 'better',
    });

    const jank = matrix.rows.find(row => row.metricKey === 'scrolling.jank_rate_pct')!;
    expect(jank.deltas[0]).toMatchObject({
      deltaValue: -5,
      assessment: 'better',
    });
    expect(matrix.evidenceRefs.map(ref => ref.type)).toContain('snapshot_metric');
  });

  test('records missing metrics without dropping comparable rows', () => {
    const matrix = buildComparisonMatrix(
      [
        snapshot('baseline', { startupMs: 1200, fps: 55 }),
        snapshot('candidate', { startupMs: 1000 }),
      ],
      {
        baselineSnapshotId: 'baseline',
        metricKeys: ['startup.total_ms', 'scrolling.avg_fps'],
      },
    );

    const fps = matrix.rows.find(row => row.metricKey === 'scrolling.avg_fps')!;
    expect(fps.missingSnapshotIds).toEqual(['candidate']);
    expect(matrix.missingMatrix.candidate['scrolling.avg_fps']).toBe('metric_not_found');
    expect(fps.deltas[0]).toMatchObject({
      deltaValue: null,
      assessment: 'unknown',
    });
  });

  test('rejects invalid baseline input', () => {
    expect(() =>
      buildComparisonMatrix(
        [
          snapshot('a', { startupMs: 1 }),
          snapshot('b', { startupMs: 2 }),
        ],
        { baselineSnapshotId: 'missing' },
      ),
    ).toThrow('Baseline snapshot is not part of comparison input');
  });
});
