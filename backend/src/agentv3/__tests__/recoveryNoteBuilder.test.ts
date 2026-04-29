// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Phase 3-2 of v2.1 — recovery-note builder unit tests.
 *
 * Compact recovery used to live as an inline 60-line block inside
 * `claudeRuntime.ts`, untestable without standing up the SDK stream.
 * The behaviour now lives in `recoveryNoteBuilder.ts` and these tests
 * lock down the priority order + new "recent_tool_calls" section.
 */

import { describe, it, expect } from '@jest/globals';
import { buildRecoveryNote } from '../recoveryNoteBuilder';
import type { AnalysisPlanV3, ToolCallRecord } from '../types';
import type { Finding } from '../../agent/types';

const plan: AnalysisPlanV3 = {
  phases: [
    { id: 'p1', name: '概览', goal: '取全帧统计', expectedTools: ['scrolling_analysis'], status: 'completed', summary: '收集 200 帧' },
    { id: 'p2', name: '根因分析', goal: '深钻 reason_code', expectedTools: ['jank_frame_detail'], status: 'in_progress' },
    { id: 'p3', name: '结论', goal: '输出报告', expectedTools: [], status: 'pending' },
  ],
  successCriteria: '识别根因',
  submittedAt: 0,
  toolCallLog: [],
};

const finding = (severity: Finding['severity'], title: string, confidence = 0.7): Finding => ({
  severity,
  title,
  description: title,
  confidence,
} as Finding);

const toolCall = (overrides: Partial<ToolCallRecord> = {}): ToolCallRecord => ({
  toolName: 'mcp__smartperfetto__execute_sql',
  timestamp: Date.now(),
  ...overrides,
});

describe('buildRecoveryNote', () => {
  it('always includes the header section', () => {
    const note = buildRecoveryNote({});
    expect(note.sectionsIncluded[0]).toBe('header');
    expect(note.text).toMatch(/上下文压缩恢复/);
  });

  it('includes plan progress with status icons + summaries', () => {
    const note = buildRecoveryNote({ plan });
    expect(note.sectionsIncluded).toContain('plan_progress');
    expect(note.text).toMatch(/✓ p1: 概览 — 收集 200 帧/);
    expect(note.text).toMatch(/→ p2: 根因分析/);
    expect(note.text).toMatch(/○ p3: 结论/);
  });

  it('points at the next pending or in-progress phase', () => {
    const note = buildRecoveryNote({ plan });
    expect(note.sectionsIncluded).toContain('next_phase');
    expect(note.text).toMatch(/当前\/下一阶段: 根因分析/);
  });

  it('preserves recent tool calls as structured digests (Phase 3-2)', () => {
    const calls: ToolCallRecord[] = [
      toolCall({ toolName: 'mcp__smartperfetto__execute_sql', inputSummary: 'SELECT * FROM frame', matchedPhaseId: 'p1' }),
      toolCall({ toolName: 'mcp__smartperfetto__invoke_skill', skillId: 'jank_frame_detail', inputSummary: 'jank_frame_detail(traceId,frameId)', matchedPhaseId: 'p2' }),
    ];
    const note = buildRecoveryNote({ recentToolCalls: calls });
    expect(note.sectionsIncluded).toContain('recent_tool_calls');
    expect(note.text).toMatch(/execute_sql/);
    expect(note.text).toMatch(/invoke_skill\(jank_frame_detail\)/);
    expect(note.text).toMatch(/\[phase:p1\]/);
    expect(note.text).toMatch(/\[phase:p2\]/);
  });

  it('keeps only the last N tool calls when more are supplied', () => {
    const calls: ToolCallRecord[] = Array.from({ length: 10 }, (_, i) =>
      toolCall({ toolName: 'mcp__smartperfetto__execute_sql', inputSummary: `query #${i}` }),
    );
    const note = buildRecoveryNote({ recentToolCalls: calls, rawToolPreserve: 3 });
    expect(note.text).toMatch(/query #9/);
    expect(note.text).toMatch(/query #8/);
    expect(note.text).toMatch(/query #7/);
    expect(note.text).not.toMatch(/query #6/);
  });

  it('omits the recent_tool_calls section entirely when rawToolPreserve is 0', () => {
    const note = buildRecoveryNote({
      recentToolCalls: [toolCall({ inputSummary: 'x' })],
      rawToolPreserve: 0,
    });
    expect(note.sectionsIncluded).not.toContain('recent_tool_calls');
  });

  it('prefers confident findings (>= 0.5) and falls back to top 3 otherwise', () => {
    // No finding meets the 0.5 confidence bar so the builder takes the
    // first 3 in input order. The 4th entry must NOT appear.
    const findings = [
      finding('warning', 'low confidence', 0.2),
      finding('warning', 'no confidence A', 0.3),
      finding('warning', 'no confidence B', 0.4),
      finding('warning', 'no confidence D', 0.4),
    ];
    const note = buildRecoveryNote({ findings });
    expect(note.sectionsIncluded).toContain('findings');
    expect(note.text).toMatch(/low confidence/);
    expect(note.text).toMatch(/no confidence A/);
    expect(note.text).toMatch(/no confidence B/);
    expect(note.text).not.toMatch(/no confidence D/);
  });

  it('uses confident findings when at least one meets the 0.5 bar', () => {
    const findings = [
      finding('warning', 'low confidence', 0.2), // dropped
      finding('warning', 'high confidence A', 0.7),
      finding('warning', 'high confidence B', 0.8),
    ];
    const note = buildRecoveryNote({ findings });
    expect(note.text).toMatch(/high confidence A/);
    expect(note.text).toMatch(/high confidence B/);
    expect(note.text).not.toMatch(/low confidence/);
  });

  it('drops sections that would exceed the char budget rather than truncate them', () => {
    const longFindings: Finding[] = Array.from({ length: 50 }, (_, i) =>
      finding('critical', 'X'.repeat(80) + ` finding-${i}`),
    );
    const note = buildRecoveryNote({
      plan,
      findings: longFindings,
      maxChars: 200, // tight budget — only header + plan_progress should fit
    });
    expect(note.sectionsIncluded[0]).toBe('header');
    expect(note.usedChars).toBeLessThanOrEqual(200);
    // findings section should be dropped wholesale, not partially
    expect(note.text).not.toMatch(/finding-49/);
  });

  it('includes the entity snapshot only when it is short enough (<200 chars)', () => {
    const tooLong = 'x'.repeat(250);
    const noteLong = buildRecoveryNote({ entitySnapshot: tooLong });
    expect(noteLong.sectionsIncluded).not.toContain('entity_context');

    const ok = buildRecoveryNote({ entitySnapshot: 'process: com.example pid=123' });
    expect(ok.sectionsIncluded).toContain('entity_context');
  });

  it('orders sections: header → plan → next_phase → tool calls → findings → entity', () => {
    const note = buildRecoveryNote({
      plan,
      recentToolCalls: [toolCall({ inputSummary: 'one' })],
      findings: [finding('warning', 'a finding')],
      entitySnapshot: 'tiny snapshot',
    });
    expect(note.sectionsIncluded).toEqual([
      'header',
      'plan_progress',
      'next_phase',
      'recent_tool_calls',
      'findings',
      'entity_context',
    ]);
  });
});
