<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# 01. SQL Guardrail 与格式化基础设施

## 目标

让 SmartPerfetto 中所有 SQL 入口共享同一套基础能力：

- 识别 SQL 中引用的 Perfetto stdlib 表、函数、macro。
- 自动补齐 raw SQL 所需 `INCLUDE PERFETTO MODULE ...`。
- 在 Skill validation 阶段发现缺失 stdlib 声明。
- 为 AI 输出 SQL 提供结构化警告，并把展示/复制路径接到 syntaqlite 格式化。

## Upstream 变化

Google Perfetto upstream 在本轮同步中引入或强化了：

- QueryPage 通过 `syntaqlite` 做 PerfettoSQL formatting。
- Trace Processor 侧删除 legacy `PerfettoSqlPreprocessor`，转向
  syntaqlite macro expansion。
- stdlib 函数、macro、intrinsic table function 插件化更明显。

这些变化意味着 SmartPerfetto 不能继续只依赖 prompt 约束 SQL。SQL 是否需要
include、是否调用了 stdlib macro/function、是否使用重复执行不安全的
`CREATE`，都应该成为代码层面的 contract。

## 现状

- `backend/src/agentv3/sqlIncludeInjector.ts` 已能为 raw SQL 自动注入 stdlib
  modules，并支持 table/function/macro 的正则识别。
- `backend/src/services/sqlGuardrailAnalyzer.ts` 已有若干低噪声 guardrail：
  idempotent create、SPAN_JOIN、direct args parsing 等。
- `backend/src/cli/commands/validate.ts` 只检查 `FROM/JOIN` 表引用，没有覆盖
  stdlib function/macro。

## 实施计划

1. 提取通用 SQL stdlib dependency analyzer。`DONE`
   - 输入：SQL string。
   - 输出：已声明 include、local CTE/table/view、stdlib symbol 引用、缺失 module。
   - 覆盖 table、function call、macro `name!(...)`。
   - 与 `sqlIncludeInjector` 共享逻辑，避免两套 parser 漂移。

2. 更新 raw SQL auto include。`DONE`
   - 复用 dependency analyzer 的 required modules。
   - 保持当前注入顺序和 idempotency。
   - 保持 comments/string literals masking。

3. 更新 Skill validator。`DONE`
   - root-level SQL 和 step SQL 都跑 dependency analyzer。
   - `prerequisites.modules` 必须覆盖 table/function/macro 的 owning module。
   - CTE/local `CREATE PERFETTO VIEW/TABLE` 不误报。

4. 扩展 guardrail。`DONE`
   - 保留默认低噪声规则。
   - strict/audit 模式下覆盖 upstream macro/function 迁移风险。
   - 只把确定性问题作为 error；可能误报的模式先作为 warning。
   - `SMARTPERFETTO_SQL_GUARDRAILS=strict|audit|fail` 已接入 Skill validator：
     默认只启用低噪声规则，`fail` 模式把 guardrail issue 提升为 error。

5. 接 syntaqlite 到 AI SQL 展示/复制。`DONE`
   - 前端 QueryPage 已有 syntaqlite runtime。
   - AgentV3 `execute_sql` SSE DataEnvelope 携带最终可执行 SQL。
   - AI Assistant 对 SQL 展示和复制使用 syntaqlite formatter；formatter 失败时
     降级到原始最终 SQL，避免阻断分析。
   - backend 先不引入新的 Node runtime dependency，避免 package/runtime 风险；
     如果后续需要 backend formatting，优先封装成 optional service。

## 测试

Focused tests:

- `npm --prefix backend run test -- src/services/__tests__/sqlStdlibDependencyAnalyzer.test.ts --runInBand`
- `npm --prefix backend run test -- src/agentv3/__tests__/sqlIncludeInjector.test.ts --runInBand`
- `npm --prefix backend run test -- src/services/__tests__/sqlGuardrailAnalyzer.test.ts --runInBand`

Validation:

- `npm --prefix backend run validate:skills`
- `npm --prefix backend run typecheck`

E2E:

- `npm --prefix backend run test:scene-trace-regression`
- `npm --prefix backend run verify:agent-sse-scrolling -- --trace ../test-traces/scroll-demo-customer-scroll.pftrace --mode fast --max-rounds 2 --timeout-ms 600000 --output test-output/upstream-sql-guardrails-sse.json`

## 验收标准

- `execute_sql` 与 Skill validator 对同一 SQL 得到一致的 stdlib dependency。
- Skill 中使用 stdlib function/macro 但未声明 module 时，validator 能报错。
- 已声明 include 或本地 CTE/local view 不误报。
- 不引入新的前端 prebuild churn。
- 完整 Perfetto SQL 语法覆盖不在本轮 claim 内；需要引入真正的
  SQL/Perfetto AST parser 才能作为形式化语法覆盖验收。
