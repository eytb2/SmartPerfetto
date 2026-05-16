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
| `perfetto-infra-querying-traces` | MCP docs、strategy methodology、SQL tool descriptions | 抽取 stdlib/querying 规范 |
| `perfetto-workflow-android-heap-dump` | `memory_analysis`、bitmap atomic skills | 转成 YAML SQL steps |
| future jank/chrome skills | scrolling/jank skills | 只提取可验证 SQL 和判断标准 |

## 实施计划

1. 建立 upstream skill review checklist。
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

## 测试

- `npm --prefix backend run validate:skills`
- 相关 scene 的 skill eval。
- 至少一个 Agent SSE e2e，确认报告语言和 evidence 支撑关系正确。
