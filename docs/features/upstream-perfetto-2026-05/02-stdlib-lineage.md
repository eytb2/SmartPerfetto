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
- 还没有 lineage asset，也没有把 `stdlib_docs.json` 内容纳入 backend tool。

## 实施计划

1. 保持 symbol index 为第一阶段权威源。
   - module list、table/function/macro owning module 先继续走现有 JSON。
   - 生成脚本增加 metadata 扩展空间，但不破坏现有 asset 版本。

2. 新增 stdlib docs ingestion。
   - 从 `frontend/v*/stdlib_docs.json` 或 submodule build output 读取。
   - 转换成 backend 可搜索的 compact docs asset。
   - `lookup_sql_schema` 返回 description、args、return_type、module。

3. 新增 lineage 生成。
   - 优先调用 upstream `pfsql lineage`，如果本地未构建则降级到纯 TS/JS
     dependency analyzer。
   - 生成 `backend/data/perfettoStdlibLineage.json`。
   - 记录 module -> declared includes、symbol -> cross-module uses。

4. Skill validator 接 lineage。
   - 对 Skill 中声明的 `prerequisites.modules` 计算 transitive dependencies。
   - 对显式 SQL 中直接引用的 symbol 报缺失 include。
   - 对 indirect dependency 只警告，避免因 upstream stdlib 内部重组导致误报。

5. MCP 工具增强。
   - `list_stdlib_modules` 返回 namespace summary + changed/new modules。
   - `query_perfetto_source` 在源码缺失时退回 docs/symbol asset，而不只退回旧
     light index。

## 测试

- `npm --prefix backend run stdlib:generate-symbol-index`
- `npm --prefix backend run validate:skills`
- `npm --prefix backend run test -- src/agentv3/__tests__/claudeMcpServer.test.ts --runInBand`
- `npm --prefix backend run test -- src/services/__tests__/stdlibSkillCoverage.test.ts --runInBand`

## E2E

- 用 startup/scrolling 查询触发 `lookup_sql_schema` + `execute_sql`。
- 检查最终报告里的 SQL evidence 能解释使用了哪些 stdlib module。
