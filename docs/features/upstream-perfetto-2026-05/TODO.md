<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# Upstream Perfetto 2026-05 TODO

当前结论：不能把 upstream 结合误报为完成。已完成并 push 的只是 M0 SQL
stdlib include guardrail 基础设施；下面任务必须按顺序开发、测试和 E2E
验证。

| 顺序 | 任务 | 状态 | 验收 |
|---|---|---|---|
| M0 | SQL stdlib dependency analyzer、auto include、Skill validator | Done | focused tests、`validate:skills`、`typecheck`、`build`、`verify:pr` 已通过 |
| M1 | syntaqlite SQL formatting、AI SQL 展示/复制、最终可执行 SQL metadata | Done | AI 结果中的 SQL 展示和复制使用最终可执行 SQL；Perfetto UI focused unittest/typecheck；刷新 committed `frontend/`；Agent SSE smoke |
| M2 | `stdlib_docs.json` + pfsql lineage 接入 SQL 知识基座 | Next | `lookup_sql_schema`/`query_perfetto_source` 能返回 docs/source/lineage；validator 检查 transitive include |
| M3 | Trace Processor Connection/Database split 映射到 trace lease/pool | Todo | 审计 `execute_sql_on`/compare skill 生命周期；多 trace comparison e2e 证明 current/reference 隔离 |
| M4 | 产品化 upstream Android 性能能力 | Todo | blocking calls、RenderThread blocking、AndroidLockContention、heap bitmap、ChromeScrollJank 逐项落入 Skill/strategy 并跑 scene/e2e |
| M5 | upstream AI skills 转译 | Todo | 只抽取查询方法和判断标准，落到 YAML Skills/strategies/SQL package；不引入第二套 Skill 体系 |

## 执行规则

1. 每完成一个 M 阶段，都更新本表状态和对应 feature 文档。
2. 每个阶段都必须包含 focused test、集成验证和至少一个 scene/e2e 入口。
3. 涉及 AI Assistant plugin UI 时，按 `.claude/rules/frontend.md` 刷新 committed `frontend/`。
4. push 前跑匹配范围的验证；准备落地时跑 `npm run verify:pr`。
