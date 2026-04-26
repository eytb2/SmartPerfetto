// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectSelfImproveMetrics } from '../metricsAggregator';

describe('collectSelfImproveMetrics', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-metrics-'));
  });

  function paths() {
    return {
      patternsFile: path.join(tmp, 'patterns.json'),
      negativePatternsFile: path.join(tmp, 'negatives.json'),
      quickPatternsFile: path.join(tmp, 'quicks.json'),
      feedbackFile: path.join(tmp, 'feedback.jsonl'),
      skillNotesDir: path.join(tmp, 'skill_notes'),
      curatedSkillNotesDir: path.join(tmp, 'curated_skill_notes'),
    };
  }

  it('returns zeros when nothing exists yet', () => {
    const metrics = collectSelfImproveMetrics(paths());
    expect(metrics.patterns.positive.total).toBe(0);
    expect(metrics.patterns.negative.total).toBe(0);
    expect(metrics.patterns.quick.total).toBe(0);
    expect(metrics.skillNotes.runtimeFiles).toBe(0);
    expect(metrics.feedback.total).toBe(0);
    expect(metrics.activeRunSnapshots).toBeGreaterThanOrEqual(0);
  });

  it('counts pattern entries by status (legacy entries fold into `legacy` bucket)', () => {
    const p = paths();
    fs.writeFileSync(p.patternsFile, JSON.stringify([
      { id: 'a', status: 'provisional', traceFeatures: [], sceneType: 's', keyInsights: [], confidence: 0.5, createdAt: 0, matchCount: 0 },
      { id: 'b', status: 'confirmed', traceFeatures: [], sceneType: 's', keyInsights: [], confidence: 0.7, createdAt: 0, matchCount: 0 },
      { id: 'c', traceFeatures: [], sceneType: 's', keyInsights: [], confidence: 0.6, createdAt: 0, matchCount: 0 }, // legacy (no status)
    ]));
    const metrics = collectSelfImproveMetrics(p);
    expect(metrics.patterns.positive.total).toBe(3);
    expect(metrics.patterns.positive.byStatus.provisional).toBe(1);
    expect(metrics.patterns.positive.byStatus.confirmed).toBe(1);
    expect(metrics.patterns.positive.byStatus.legacy).toBe(1);
  });

  it('counts skill notes across runtime and curated directories', () => {
    const p = paths();
    fs.mkdirSync(p.skillNotesDir, { recursive: true });
    fs.mkdirSync(p.curatedSkillNotesDir, { recursive: true });
    fs.writeFileSync(path.join(p.skillNotesDir, 's1.notes.json'), JSON.stringify({
      schemaVersion: 1, skillId: 's1', notes: [{ id: 'n1' }, { id: 'n2' }], lastUpdated: 0, totalBytes: 0,
    }));
    fs.writeFileSync(path.join(p.curatedSkillNotesDir, 's1.notes.json'), JSON.stringify({
      schemaVersion: 1, skillId: 's1', notes: [{ id: 'curated-1' }], lastUpdated: 0, totalBytes: 0,
    }));
    const metrics = collectSelfImproveMetrics(p);
    expect(metrics.skillNotes.runtimeFiles).toBe(1);
    expect(metrics.skillNotes.runtimeNotes).toBe(2);
    expect(metrics.skillNotes.curatedFiles).toBe(1);
    expect(metrics.skillNotes.curatedNotes).toBe(1);
  });

  it('parses feedback JSONL into positive/negative tallies', () => {
    const p = paths();
    const lines = [
      JSON.stringify({ rating: 'positive', sessionId: 's1' }),
      JSON.stringify({ rating: 'negative', sessionId: 's2' }),
      JSON.stringify({ rating: 'negative', sessionId: 's3' }),
      'corrupt-line-skipped',
    ];
    fs.writeFileSync(p.feedbackFile, lines.join('\n') + '\n');
    const metrics = collectSelfImproveMetrics(p);
    // Three valid lines, the corrupt one is silently dropped.
    expect(metrics.feedback.total).toBe(3);
    expect(metrics.feedback.positive).toBe(1);
    expect(metrics.feedback.negative).toBe(2);
  });

  it('records a warning when a JSON file is corrupt', () => {
    const p = paths();
    fs.writeFileSync(p.patternsFile, '{ malformed');
    const metrics = collectSelfImproveMetrics(p);
    expect(metrics.warnings.some(w => w.includes('patterns.json'))).toBe(true);
  });

  it('exposes the canonical SupersedeState keys with zero defaults', () => {
    const metrics = collectSelfImproveMetrics(paths());
    // No supersede DB exists in the tmp dir, so we get the default zeros
    // either via opening it (creates an empty DB) or via the catch path.
    for (const k of [
      'pending_review', 'active_canary', 'active',
      'failed', 'rejected', 'drifted', 'reverted',
    ]) {
      expect(metrics.supersede[k as keyof typeof metrics.supersede]).toBeGreaterThanOrEqual(0);
    }
  });

  it('exposes outbox state buckets with default zeros', () => {
    const metrics = collectSelfImproveMetrics(paths());
    for (const k of ['pending', 'leased', 'done', 'failed']) {
      expect(metrics.outbox.byState[k as keyof typeof metrics.outbox.byState]).toBeGreaterThanOrEqual(0);
    }
    expect(metrics.outbox.dailyJobs).toBeGreaterThanOrEqual(0);
  });
});
