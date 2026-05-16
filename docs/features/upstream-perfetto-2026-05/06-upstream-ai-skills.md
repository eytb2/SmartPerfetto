<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# 06. Upstream AI Skills 转译策略

## 目标

把 Google Perfetto upstream `ai/skills/` 中有价值的 runbook 知识转译到
SmartPerfetto 的 YAML Skill/Strategy 体系，而不是直接引入另一套 skill runtime。

## 原则

- upstream markdown skills 是知识源，不是 SmartPerfetto runtime contract。
- SmartPerfetto 的可执行 evidence 必须进入 `backend/skills/`。
- 推理方法和报告结构进入 `backend/strategies/` 或 `backend/skills/docs/`。
- 不把长 prompt 文案硬编码到 TypeScript。

## 首批映射

| upstream skill | SmartPerfetto 落点 | 处理方式 |
|---|---|---|
| `perfetto-infra-querying-traces` | SQL stdlib docs/lineage lookup、auto include validator、MCP SQL guidance | 已落地：查询前用 stdlib docs / source / lineage，保存 SQL 不写 `SELECT *` |
| `perfetto-infra-getting-trace-processor` | 现有 `trace_processor_shell` pool、setup docs | 不转成 runtime skill；SmartPerfetto 已内置 TP pool/lease |
| `perfetto-workflow-android-heap-dump` | `android_heap_graph_summary`、`android_bitmap_memory_per_process`、`memory.strategy.md` | 已转成 YAML SQL steps + no-data contract |
| Chrome Scroll Jank runbook/plugin knowledge | `chrome_scroll_jank_frame_timeline`、`scrolling.strategy.md` | 已抽取 v3/v4 scroll jank 与 preferred frame timeline availability |

## 实施计划

1. 建立 upstream skill review checklist。
   已落地到 `backend/skills/docs/upstream-perfetto-ai-skill-translation.sop.md`：
   - 是否包含可执行 SQL。
   - 是否依赖 Google 内部路径。
   - 是否可映射到现有 scene。
   - 是否有 fixture 可验证。

2. 建立转译模板。
   - runbook step -> YAML skill step。
   - interpretation -> output metadata / diagnosis rule。
   - caveat -> strategy note 或 skill doc。

3. 每个转译 PR 必须包含：
   - upstream source 摘要。
   - SmartPerfetto YAML diff。
   - validator + scene/e2e 结果。

## 本轮落地

- 新增 `android_heap_graph_summary`：对应 upstream heap-dump workflow 的 Step 1/2，
  输出 heap graph availability、sample orientation、top retained classes。
- 升级 `android_bitmap_memory_per_process`：保留 `android.bitmaps` counter 路径，
  同时在 TP 支持时读取 `heap_graph_bitmaps` width/height/storage/source attribution。
- 新增 `chrome_scroll_jank_frame_timeline`：抽取 ChromeScrollJank v3/v4 scroll
  jank、tagging 与 preferred frame timeline availability。
- 新增转译 SOP：明确 upstream markdown 只是知识源，SmartPerfetto runtime 只走
  YAML Skill、strategy、SQL docs/lineage。

## 测试

- `npm --prefix backend run validate:skills`
- 相关 scene 的 skill eval。
- 至少一个 Agent SSE e2e，确认报告语言和 evidence 支撑关系正确。
