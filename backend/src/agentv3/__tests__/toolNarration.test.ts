// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { describe, expect, it } from '@jest/globals';
import {
  formatToolCallNarration,
  looksLikeGenericToolMessage,
} from '../toolNarration';

describe('toolNarration', () => {
  it('describes submit_plan with phase goals', () => {
    const text = formatToolCallNarration('submit_plan', {
      phases: [
        { id: 'p1', name: '概览采集', goal: '获取帧统计和卡顿分布' },
        { id: 'p2', name: '根因分析', goal: '下钻主线程与调度证据' },
      ],
    });

    expect(text).toContain('制定分析计划');
    expect(text).toContain('获取帧统计和卡顿分布');
    expect(text).toContain('根因分析');
  });

  it('describes invoke_skill with skill id, purpose, and params', () => {
    const text = formatToolCallNarration('mcp__smartperfetto__invoke_skill', {
      skillId: 'startup_analysis',
      params: { process_name: 'com.example', enable_startup_details: false },
    });

    expect(text).toContain('调用 Skill startup_analysis');
    expect(text).toContain('定位启动事件');
    expect(text).toContain('process_name=com.example');
  });

  it('describes update_plan_phase with status and evidence', () => {
    const text = formatToolCallNarration('update_plan_phase', {
      phaseId: 'p1',
      status: 'completed',
      summary: '已经拿到启动事件表',
    });

    expect(text).toContain('推进计划阶段 p1 -> completed');
    expect(text).toContain('已经拿到启动事件表');
  });

  it('identifies generic tool messages that should be replaced', () => {
    expect(looksLikeGenericToolMessage('调用工具: invoke_skill')).toBe(true);
    expect(looksLikeGenericToolMessage('Call tool: submit_plan')).toBe(true);
    expect(looksLikeGenericToolMessage('调用 Skill startup_analysis：定位启动事件')).toBe(false);
  });
});
