// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import {
  ANALYSIS_RESULT_SNAPSHOT_SCHEMA_VERSION,
  type AnalysisResultSnapshot,
} from '../../types/multiTraceComparison';
import { generateAiComparisonConclusion } from '../comparisonAiConclusionService';
import { buildDeterministicComparisonResult } from '../comparisonResultService';

function snapshot(
  id: string,
  values: {
    startupMs: number;
    fps: number;
    jankRate: number;
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
      {
        key: 'startup.total_ms',
        label: 'Startup total duration',
        group: 'startup',
        value: values.startupMs,
        unit: 'ms',
        direction: 'lower_is_better',
        aggregation: 'single',
        confidence: 0.9,
        source: { type: 'skill' },
      },
      {
        key: 'scrolling.avg_fps',
        label: 'Average FPS',
        group: 'fps',
        value: values.fps,
        unit: 'fps',
        direction: 'higher_is_better',
        aggregation: 'avg',
        confidence: 0.9,
        source: { type: 'skill' },
      },
      {
        key: 'scrolling.jank_rate_pct',
        label: 'Jank rate',
        group: 'jank',
        value: values.jankRate,
        unit: '%',
        direction: 'lower_is_better',
        aggregation: 'avg',
        confidence: 0.9,
        source: { type: 'skill' },
      },
    ],
    evidenceRefs: [],
    status: 'ready',
    schemaVersion: ANALYSIS_RESULT_SNAPSHOT_SCHEMA_VERSION,
    createdAt: 1_700_000_000_000,
  };
}

function comparisonResult() {
  return buildDeterministicComparisonResult(
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
}

describe('generateAiComparisonConclusion', () => {
  test('parses AI conclusion JSON from an injected client', async () => {
    const prompts: string[] = [];
    const conclusion = await generateAiComparisonConclusion({
      result: comparisonResult(),
      query: 'compare startup and smoothness',
      client: {
        async complete(input) {
          prompts.push(input.prompt);
          return {
            model: 'mock-light-model',
            text: JSON.stringify({
              verifiedFacts: ['Candidate startup is 300 ms faster than baseline.'],
              inferences: ['Candidate is likely better for the tested startup path.'],
              recommendations: ['Inspect the startup changes that reduced total duration.'],
              uncertainty: ['Only normalized snapshot metrics were compared.'],
            }),
          };
        },
      },
    });

    expect(prompts[0]).toContain('compare startup and smoothness');
    expect(prompts[0]).toContain('"startup.total_ms"');
    expect(conclusion).toMatchObject({
      source: 'ai',
      model: 'mock-light-model',
      verifiedFacts: ['Candidate startup is 300 ms faster than baseline.'],
      inferences: ['Candidate is likely better for the tested startup path.'],
      recommendations: ['Inspect the startup changes that reduced total duration.'],
    });
    expect(conclusion.uncertainty).toContain('Only normalized snapshot metrics were compared.');
  });

  test('falls back to deterministic conclusion when AI output is not parseable', async () => {
    const result = comparisonResult();
    const conclusion = await generateAiComparisonConclusion({
      result,
      query: 'compare startup',
      client: {
        async complete() {
          return { text: 'not json' };
        },
      },
    });

    expect(conclusion.source).toBe('deterministic');
    expect(conclusion.verifiedFacts).toEqual(result.conclusion.verifiedFacts);
    expect(conclusion.uncertainty).toContain(
      'AI comparison conclusion was not generated: AI response did not contain valid conclusion JSON',
    );
  });
});
