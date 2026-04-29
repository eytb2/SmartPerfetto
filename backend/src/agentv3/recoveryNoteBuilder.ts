// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Pure builder for the post-compact recovery note that gets persisted
 * to `sessionNotes` and re-injected into the next turn's system prompt.
 *
 * Extracted from `claudeRuntime.ts` (Phase 3-2 of v2.1) so the logic can
 * be unit-tested without standing up the full SDK stream loop. Phase 3-3
 * will additionally call this from the `interrupt` + `resume` fallback
 * (when the token meter trips) so the recovery preamble is built from
 * the same code path as the post-compact note.
 *
 * Sections in priority order, each added wholesale via the `tryAdd`
 * budget gate (no mid-section truncation). The first section that
 * doesn't fit is dropped:
 *
 *   1. Plan progress (statuses + summaries) — highest priority
 *   2. Next/in-progress phase pointer (with expected tools)
 *   3. Recent raw tool origins (last N=5, structured digest only)
 *   4. Key findings (confident first; falls back to all)
 *   5. Entity context (known process / thread names)
 *
 * Section 3 is the v2.1 Phase 3-2 addition: the previous note flattened
 * the recent tool calls into "findings" and lost the post-compact
 * "what did the agent just do?" signal.
 */

import type { AnalysisPlanV3, ToolCallRecord } from './types';
import type { Finding } from '../agent/types';

export const DEFAULT_MAX_NOTE_CHARS = 800;
export const DEFAULT_RAW_TOOL_PRESERVE = 5;

export interface RecoveryNoteInput {
  plan?: AnalysisPlanV3;
  findings?: ReadonlyArray<Finding>;
  /** Recent tool calls (already trimmed and time-ordered). */
  recentToolCalls?: ReadonlyArray<ToolCallRecord>;
  /** Optional human-readable entity snapshot — typically the output of `buildEntityContext`. */
  entitySnapshot?: string;
  /** Override character budget (default 800). */
  maxChars?: number;
  /** Override how many recent tool calls to keep (default 5). */
  rawToolPreserve?: number;
}

export interface RecoveryNote {
  text: string;
  sectionsIncluded: string[];
  usedChars: number;
}

function summariseToolCall(call: ToolCallRecord): string {
  const short = call.toolName.replace('mcp__smartperfetto__', '');
  const skill = call.skillId ? `(${call.skillId})` : '';
  const input = call.inputSummary ? ` — ${call.inputSummary}` : '';
  const phase = call.matchedPhaseId ? ` [phase:${call.matchedPhaseId}]` : '';
  return `· ${short}${skill}${input}${phase}`.slice(0, 160);
}

/**
 * Build the recovery note as a single string plus structured metadata.
 * Pure function — does not touch sessionNotes or the SDK.
 */
export function buildRecoveryNote(input: RecoveryNoteInput): RecoveryNote {
  const maxChars = input.maxChars ?? DEFAULT_MAX_NOTE_CHARS;
  const rawToolPreserve = Math.max(0, input.rawToolPreserve ?? DEFAULT_RAW_TOOL_PRESERVE);

  const sections: string[] = [];
  const sectionsIncluded: string[] = [];
  let usedChars = 0;

  const tryAdd = (label: string, section: string): boolean => {
    if (usedChars + section.length + 1 > maxChars) return false;
    sections.push(section);
    sectionsIncluded.push(label);
    usedChars += section.length + 1;
    return true;
  };

  tryAdd('header', '[上下文压缩恢复] SDK 自动压缩已触发。');

  // Section 1: plan progress
  if (input.plan) {
    const planLines = input.plan.phases.map(p => {
      const icon = p.status === 'completed'
        ? '✓'
        : p.status === 'skipped'
          ? '⊘'
          : p.status === 'in_progress'
            ? '→'
            : '○';
      const summary = p.summary ? ` — ${p.summary.substring(0, 60)}` : '';
      return `${icon} ${p.id}: ${p.name}${summary}`;
    });
    if (planLines.length > 0) {
      tryAdd('plan_progress', `分析进度:\n${planLines.join('\n')}`);
    }

    // Section 2: next/in-progress phase pointer
    const nextPhase = input.plan.phases.find(p => p.status === 'pending' || p.status === 'in_progress');
    if (nextPhase) {
      const tools = nextPhase.expectedTools.length > 0
        ? ` (工具: ${nextPhase.expectedTools.join(', ')})`
        : '';
      tryAdd('next_phase', `当前/下一阶段: ${nextPhase.name} — ${nextPhase.goal}${tools}`);
    }
  }

  // Section 3: recent raw tool origins (Phase 3-2 addition)
  if (rawToolPreserve > 0 && input.recentToolCalls && input.recentToolCalls.length > 0) {
    const recent = input.recentToolCalls.slice(-rawToolPreserve);
    const toolLines = recent.map(summariseToolCall).join('\n');
    tryAdd('recent_tool_calls', `近 ${recent.length} 次工具调用（结构化摘要）:\n${toolLines}`);
  }

  // Section 4: key findings (confident first)
  if (input.findings && input.findings.length > 0) {
    const confident = input.findings.filter(f => (f.confidence ?? 0.5) >= 0.5);
    const list = confident.length > 0 ? confident.slice(0, 5) : input.findings.slice(0, 3);
    const summary = list.map(f => `- [${f.severity}] ${f.title}`).join('\n');
    tryAdd('findings', `关键发现:\n${summary}`);
  }

  // Section 5: entity context (lowest priority)
  if (input.entitySnapshot && input.entitySnapshot.length < 200) {
    tryAdd('entity_context', `已知实体:\n${input.entitySnapshot}`);
  }

  return {
    text: sections.join('\n'),
    sectionsIncluded,
    usedChars,
  };
}
