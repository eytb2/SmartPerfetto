// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { DEFAULT_OUTPUT_LANGUAGE, localize, type OutputLanguage } from './outputLanguage';

const MCP_PREFIX = 'mcp__smartperfetto__';
const MAX_MESSAGE_CHARS = 220;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function flatten(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function shorten(value: string, max = MAX_MESSAGE_CHARS): string {
  const flat = flatten(value);
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

function shortToolName(toolName: string): string {
  const cleaned = toolName.startsWith(MCP_PREFIX)
    ? toolName.slice(MCP_PREFIX.length)
    : toolName;
  return cleaned.replace(/^smartperfetto__/, '');
}

function parseArray(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[]
        : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[]
    : [];
}

function paramSummary(params: unknown): string {
  const paramRecord = asRecord(params);
  const entries = Object.entries(paramRecord)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 4)
    .map(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return `${key}=${String(value)}`;
      }
      return key;
    });
  return entries.join(', ');
}

function phaseSummary(phases: Record<string, unknown>[]): string {
  return phases
    .slice(0, 4)
    .map((phase) => {
      const id = readString(phase.id);
      const name = readString(phase.name);
      const goal = readString(phase.goal);
      const label = [id, name].filter(Boolean).join(' ');
      return goal ? `${label || '阶段'}: ${goal}` : (label || '阶段');
    })
    .filter(Boolean)
    .join('；');
}

function sqlTableHint(sql: string, language: OutputLanguage): string {
  const tableMatch = sql.match(/\bfrom\s+([a-zA-Z0-9_]+)/i);
  const table = tableMatch?.[1] || '';
  const tableHints: Record<string, { zh: string; en: string }> = {
    actual_frame_timeline_slice: { zh: '实际帧时间线', en: 'actual frame timeline' },
    actual_frame_timeline_event: { zh: '实际帧时间线', en: 'actual frame timeline' },
    expected_frame_timeline_event: { zh: '预期帧时间线', en: 'expected frame timeline' },
    frame_slice: { zh: '帧 Slice', en: 'frame slices' },
    slice: { zh: 'Trace Slice', en: 'trace slices' },
    thread_state: { zh: '线程状态', en: 'thread states' },
    thread: { zh: '线程信息', en: 'thread metadata' },
    process: { zh: '进程信息', en: 'process metadata' },
    counter: { zh: '计数器', en: 'counters' },
    sched_slice: { zh: 'CPU 调度', en: 'CPU scheduling' },
    android_launches: { zh: '应用启动', en: 'app launches' },
    android_app_process_starts: { zh: '进程启动', en: 'process starts' },
    cpu_counter_track: { zh: 'CPU 频率', en: 'CPU frequency' },
    gpu_counter_track: { zh: 'GPU 频率', en: 'GPU frequency' },
    memory_counter: { zh: '内存计数', en: 'memory counters' },
    android_binder_transaction: { zh: 'Binder 事务', en: 'Binder transactions' },
  };
  const hint = tableHints[table]
    ? localize(language, tableHints[table].zh, tableHints[table].en)
    : table;
  return hint;
}

function skillPurpose(skillId: string, language: OutputLanguage): string {
  const id = skillId.toLowerCase();
  const exact: Record<string, { zh: string; en: string }> = {
    startup_analysis: {
      zh: '定位启动事件、阶段耗时和候选慢点',
      en: 'identify launch events, phase timing, and slow candidates',
    },
    startup_detail: {
      zh: '下钻单次启动的主线程、调度和阻塞细节',
      en: 'drill into one launch with main-thread, scheduling, and blocking details',
    },
    startup_slow_reasons: {
      zh: '验证启动慢的可疑原因',
      en: 'check likely causes of slow startup',
    },
    scrolling_analysis: {
      zh: '统计滑动会话、帧率、掉帧帧和卡顿分布',
      en: 'summarize scroll sessions, frame rate, jank frames, and jank distribution',
    },
    jank_frame_detail: {
      zh: '下钻单帧卡顿的执行链路和根因线索',
      en: 'drill into one janky frame and its root-cause clues',
    },
    process_identity_resolver: {
      zh: '确认目标进程/包名，避免查错进程',
      en: 'resolve the target process/package to avoid querying the wrong process',
    },
  };
  if (exact[id]) return localize(language, exact[id].zh, exact[id].en);

  const patternHints: Array<[RegExp, { zh: string; en: string }]> = [
    [/binder/, { zh: '分析 Binder 调用、阻塞和跨进程延迟', en: 'analyze Binder calls, blocking, and IPC latency' }],
    [/sched|cpu/, { zh: '分析 CPU 调度、Runnable 等待和大小核分配', en: 'analyze CPU scheduling, runnable waits, and core placement' }],
    [/memory|lmk|gc/, { zh: '分析内存、GC 或 LMK 压力', en: 'analyze memory, GC, or LMK pressure' }],
    [/io|file|database/, { zh: '分析 I/O、文件或数据库耗时', en: 'analyze I/O, file, or database latency' }],
    [/thermal|power|battery|wattson/, { zh: '分析温度、功耗或电池相关证据', en: 'analyze thermal, power, or battery evidence' }],
    [/frame|jank|scroll|choreographer/, { zh: '分析帧渲染和卡顿相关证据', en: 'analyze frame rendering and jank evidence' }],
  ];
  for (const [pattern, text] of patternHints) {
    if (pattern.test(id)) return localize(language, text.zh, text.en);
  }
  return localize(language, '获取结构化证据，支撑后续诊断', 'collect structured evidence for the diagnosis');
}

export function formatToolCallNarration(
  rawToolName: string,
  rawArgs: unknown,
  language: OutputLanguage = DEFAULT_OUTPUT_LANGUAGE,
): string {
  const toolName = shortToolName(readString(rawToolName) || 'unknown');
  const args = asRecord(rawArgs);

  switch (toolName) {
    case 'submit_plan': {
      const objective = readString(args.objective);
      const phases = parseArray(args.phases);
      const summary = phaseSummary(phases);
      const detail = summary || objective;
      return shorten(detail
        ? localize(language, `制定分析计划：${detail}`, `Create analysis plan: ${detail}`)
        : localize(language, '制定分析计划：明确要收集的证据和验证顺序', 'Create analysis plan: define evidence and validation order'));
    }
    case 'update_plan_phase': {
      const phaseId = readString(args.phaseId || args.id) || 'phase';
      const status = readString(args.status) || readString(args.state) || 'updated';
      const summary = readString(args.summary || args.evidence || args.evidenceSummary);
      return shorten(summary
        ? localize(language, `推进计划阶段 ${phaseId} -> ${status}：${summary}`, `Update plan phase ${phaseId} -> ${status}: ${summary}`)
        : localize(language, `推进计划阶段 ${phaseId} -> ${status}`, `Update plan phase ${phaseId} -> ${status}`));
    }
    case 'revise_plan': {
      const phases = parseArray(args.updatedPhases || args.phases);
      const summary = phaseSummary(phases);
      const reason = readString(args.reason);
      return shorten(summary || reason
        ? localize(language, `修订分析计划：${summary || reason}`, `Revise analysis plan: ${summary || reason}`)
        : localize(language, '修订分析计划：根据已发现证据调整后续步骤', 'Revise analysis plan: adjust next steps based on evidence'));
    }
    case 'invoke_skill': {
      const skillId = readString(args.skillId) || readString(args.skill) || 'unknown_skill';
      const purpose = skillPurpose(skillId, language);
      const params = paramSummary(args.params);
      const paramsText = params
        ? localize(language, `；参数：${params}`, `; params: ${params}`)
        : '';
      return shorten(localize(
        language,
        `调用 Skill ${skillId}：${purpose}${paramsText}`,
        `Run Skill ${skillId}: ${purpose}${paramsText}`,
      ));
    }
    case 'execute_sql': {
      const sql = readString(args.sql);
      const hint = sqlTableHint(sql, language);
      return shorten(hint
        ? localize(language, `执行 SQL：查询 ${hint} 来验证具体数据`, `Run SQL: query ${hint} to verify specific data`)
        : localize(language, '执行 SQL：补充验证 Skill 未直接覆盖的数据', 'Run SQL: verify data not directly covered by a Skill'));
    }
    case 'fetch_artifact': {
      const artifactId = readString(args.artifactId || args.id) || '?';
      const detail = readString(args.detail || args.level) || 'rows';
      return localize(
        language,
        `读取 artifact ${artifactId} 的 ${detail} 详情：展开前面 Skill 的完整数据`,
        `Fetch ${detail} details from artifact ${artifactId}: expand full data from a previous Skill`,
      );
    }
    case 'list_skills':
      return localize(language, '查询可用 Skill 列表：选择合适的数据采集工具', 'List available Skills: choose an evidence collection tool');
    case 'detect_architecture':
      return localize(language, '检测渲染架构：判断后续该按哪条渲染链路分析', 'Detect rendering architecture: choose the rendering pipeline to analyze');
    case 'lookup_sql_schema': {
      const keyword = readString(args.keyword || args.table || args.query);
      return shorten(keyword
        ? localize(language, `查询 SQL 表结构：${keyword}`, `Look up SQL schema: ${keyword}`)
        : localize(language, '查询 SQL 表结构：确认字段和可用表', 'Look up SQL schema: confirm fields and available tables'));
    }
    case 'write_analysis_note': {
      const section = readString(args.section);
      return shorten(section
        ? localize(language, `记录分析笔记：${section}`, `Write analysis note: ${section}`)
        : localize(language, '记录分析笔记：保留后续结论需要的中间判断', 'Write analysis note: keep an intermediate judgment for the conclusion'));
    }
    case 'query_perfetto_source': {
      const keyword = readString(args.keyword || args.query);
      return shorten(keyword
        ? localize(language, `搜索 Perfetto 源码：${keyword}`, `Search Perfetto source: ${keyword}`)
        : localize(language, '搜索 Perfetto 源码：确认表/函数的官方语义', 'Search Perfetto source: confirm official table/function semantics'));
    }
    default:
      return shorten(localize(language, `调用工具 ${toolName}`, `Call tool ${toolName}`));
  }
}

export function looksLikeGenericToolMessage(message: string): boolean {
  const text = flatten(message).toLowerCase();
  if (!text) return true;
  return /^调用工具[:：]\s*/.test(text) ||
    /^call tool[:：]\s*/.test(text) ||
    /^调用\s+(mcp__smartperfetto__)?[a-z0-9_]+$/.test(text);
}
