<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# Upstream Perfetto 2026-05 TODO

当前结论：M0-M5 已按顺序落地。M4/M5 代码、文档和最终 `verify:pr`
已通过，等待提交并 push。

| 顺序 | 任务 | 状态 | 验收 |
|---|---|---|---|
| M0 | SQL stdlib dependency analyzer、auto include、Skill validator | Done | focused tests、`validate:skills`、`typecheck`、`build`、`verify:pr` 已通过 |
| M1 | syntaqlite SQL formatting、AI SQL 展示/复制、最终可执行 SQL metadata | Done | AI 结果中的 SQL 展示和复制使用最终可执行 SQL；Perfetto UI focused unittest/typecheck；刷新 committed `frontend/`；Agent SSE smoke |
| M2 | `stdlib_docs.json` + pfsql lineage 接入 SQL 知识基座 | Done | `lookup_sql_schema`/`query_perfetto_source` 返回 docs/source/lineage；validator 已检查 transitive include；本机 `pfsql` binary 不可用时记录为 `unavailable` 并使用 stdlib docs include closure |
| M3 | Trace Processor Connection/Database split 映射到 trace lease/pool | Done | `traceProcessorConnectionModel` 显式输出 database/connection/query provenance；`execute_sql_on`、`compare_skill` 和 data SSE envelope 均携带 `traceSide`/`traceId`；focused tests、lease routing tests、built-dist contract e2e 已通过 |
| M4 | 产品化 upstream Android 性能能力 | Done | `android_heap_graph_summary`、`android_bitmap_memory_per_process` heap fallback、`frame_blocking_calls` thread-role provenance、`lock_contention_*` owner-thread provenance、`chrome_scroll_jank_frame_timeline` 已落入 Skill/strategy 并有 focused eval |
| M5 | upstream AI skills 转译 | Done | 只抽取查询方法和判断标准；新增 translation SOP，heap-dump/querying/ChromeScrollJank 知识已落到 YAML Skills/strategies/SQL docs，不引入第二套 Skill 体系 |

## 执行规则

1. 每完成一个 M 阶段，都更新本表状态和对应 feature 文档。
2. 每个阶段都必须包含 focused test、集成验证和至少一个 scene/e2e 入口。
3. 涉及 AI Assistant plugin UI 时，按 `.claude/rules/frontend.md` 刷新 committed `frontend/`。
4. push 前跑匹配范围的验证；准备落地时跑 `npm run verify:pr`。
