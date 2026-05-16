<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# 02. Stdlib Docs、Symbol Index 与 Lineage 校验

## 目标

把 upstream 的 stdlib metadata 变成 SmartPerfetto 的 SQL 知识基座：

- MCP `lookup_sql_schema` 能返回更完整的官方 stdlib symbol 信息。
- Skill validator 能发现缺失 include 和跨模块依赖。
- report/AI 能解释某个 SQL 结果来自哪个 stdlib module。

## Upstream 变化

本轮 upstream 带来了：

- `stdlib_docs.json` 生成进入 UI build。
- `pfsql lineage` 离线工具，用于解析 stdlib `.sql` tree 的 symbol dependency。
- stdlib 中新增 bitmap、blocking calls、Wattson、jank 等 Android 相关模块。

## 现状

- `backend/data/perfettoStdlibSymbols.json` 已保存 module 和 symbol -> module
  映射。
- `backend/scripts/generate-stdlib-symbol-index.cjs` 可从 submodule 生成 symbol
  index。
- `backend/src/services/perfettoStdlibScanner.ts` 已支持 runtime asset fallback。
- `backend/data/perfettoSqlDocs.json` 已保存从 upstream `stdlib_docs.json` 生成的
  module/entity docs、direct/transitive includes 和 pfsql lineage 状态。
- `backend/src/services/perfettoSqlDocs.ts` 已提供 runtime loader/search、module
  closure 和 validator 覆盖判断。

## 实施计划

1. 保持 symbol index 为第一阶段权威源。
   - module list、table/function/macro owning module 先继续走现有 JSON。
   - 生成脚本增加 metadata 扩展空间，但不破坏现有 asset 版本。
   - 状态：Done。

2. 新增 stdlib docs ingestion。
   - 从 `frontend/v*/stdlib_docs.json` 或 submodule build output 读取。
   - 转换成 backend 可搜索的 compact docs asset。
   - `lookup_sql_schema` 返回 description、args、return_type、module。
   - 状态：Done，生成入口为 `npm --prefix backend run stdlib:generate-sql-docs`。

3. 新增 lineage 生成。
   - 优先调用 upstream `pfsql lineage`，如果本地未构建则记录
     `pfsqlLineage.status=unavailable`。
   - 生成 `backend/data/perfettoSqlDocs.json`，其中 module 记录 declared includes
     和 transitive include closure；如果 `PFSQL_BIN` 可用则额外记录 symbol-level
     uses/missing includes/errors。
   - 状态：Done；本机当前无 `pfsql` binary，已走官方 docs include closure fallback。

4. Skill validator 接 lineage。
   - 对 SQL 中声明的 `INCLUDE PERFETTO MODULE` 计算 transitive dependencies。
   - 对显式 SQL 中直接引用的 symbol 报缺失 include。
   - 已覆盖 `INCLUDE android.frames.timeline` 后使用其依赖模块
     `slices.with_context.thread_slice` 的场景。
   - 状态：Done。

5. MCP 工具增强。
   - `lookup_sql_schema` 返回 module/include/tags/columns/params/transitive includes。
   - `list_stdlib_modules` 在 namespace 查询时返回 module docs/includes/symbols。
   - `query_perfetto_source` 同时返回源码 grep 结果和 docs/lineage 摘要；源码缺失时
     继续退回 bundled schema index。
   - 状态：Done。

## 测试

- `npm --prefix backend run stdlib:generate-sql-docs`
- `npm --prefix backend run test -- src/services/__tests__/perfettoSqlDocs.test.ts --runInBand`
- `npm --prefix backend run test -- src/services/__tests__/sqlStdlibDependencyAnalyzer.test.ts --runInBand`
- `npm --prefix backend run test -- src/agentv3/__tests__/claudeMcpServer.test.ts --runInBand`
- `npm --prefix backend run typecheck`
- `npm --prefix backend run build`

## E2E

- 已用 built `backend/dist` 执行工具级 E2E：查询 `android_frames` 能返回
  `android.frames.timeline`、`INCLUDE PERFETTO MODULE android.frames.timeline;` 和
  `slices.with_context` transitive include；validator 对
  `INCLUDE android.frames.timeline; SELECT ... FROM thread_slice` 不再误报缺失模块。
- 下一阶段 M3 再接多 trace comparison scene/e2e。
