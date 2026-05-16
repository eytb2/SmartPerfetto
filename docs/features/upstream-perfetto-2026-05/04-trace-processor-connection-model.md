<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# 04. Trace Processor Connection / Database 映射

## 目标

把 upstream Trace Processor 的 `Connection` / `Database` 拆分思想映射到
SmartPerfetto 的 trace processor pool、lease、comparison 和 multi-trace
能力，避免不同 trace/session 之间状态串扰。

## Upstream 变化

Perfetto upstream 将部分 `Engine` 语义拆成：

- database-scoped state：stdlib packages、macros、committed vtab state。
- connection-scoped state：SQLite connection、registered functions/modules、
  per-connection execution state。
- cross-connection xConnect support。

## 现状

SmartPerfetto backend 已有：

- `WorkingTraceProcessor` / external RPC processor。
- lease store、SQL worker queue、RAM budget。
- `execute_sql_on` 和 `compare_skill` 的 current/reference 双 trace 工具。
- enterprise isolation 相关测试。

## 实施计划

1. 现状审计。Done。
   - 明确每个 `traceId` 对应的 process、RPC endpoint、worker queue、stdlib
     preload 状态。
   - 当前 backend 使用 `processorKey` 作为 TP database/process 选择键；shared
     lease 复用 `traceId`，isolated lease 使用 `traceId:lease:<leaseId>`。

2. Contract 命名。Done。
   - 在 backend 内部显式区分：
     - `TraceProcessorLease`
     - `TraceProcessorConnection`
     - `TraceProcessorDatabaseScope`
   - 不要求 C++ TP 直接暴露同名对象，但 backend contract 要对齐概念。
   - 本轮新增 `backend/src/services/traceProcessorConnectionModel.ts`，统一生成
     `TraceProcessorDatabaseScope`、`TraceProcessorConnectionScope` 和
     `TraceProcessorQueryProvenance`。

3. 多 Trace 查询边界。Done。
   - 保持 `execute_sql_on(trace, sql)` 明确指定 side。
   - 不允许 implicit current/reference 混用。
   - 对 comparison tool 记录每个 result 的 trace side 和 traceId。
   - `execute_sql`、`execute_sql_on`、`compare_skill` 的 JSON result 和 data SSE
     envelope 均携带 `traceSide`、`traceId`、`traceProvenance`。

4. xConnect 研究原型。Deferred。
   - 先做实验脚本，不进默认产品路径。
   - 验证 cross-connection 查询是否适合 SmartPerfetto 的 remote RPC/worker
     模式。

5. Pool/lease 验证。Partial。
   - 增加 same-page second trace、cross-window two traces、reference trace 的回归。
   - 保证 backend-created lease 和普通 UI FILE/URL trace engine 不互相覆盖。
   - 本轮覆盖 processor key helper、lease routing 回归和 comparison tool
     provenance；浏览器级 multi-window 回归留到 M4/M5 UI/e2e 矩阵补齐。

## 落地状态

2026-05-16 M3 已落地：

- `TraceProcessorService.processorKeyForLease` 改为复用
  `traceProcessorConnectionModel`，避免 lease processor key 规则在不同模块重复。
- `execute_sql_on` 对 current/reference 明确记录 query provenance，返回结果不再只靠
  `[当前 Trace]`/`[参考 Trace]` 文本标签区分。
- `compare_skill` 对 current/reference 两次 skill execution 分别输出 provenance，
  并把同样信息附着到 data SSE envelope，前端/报告层可以基于结构化字段区分 side。

## 测试

- `npm --prefix backend run test -- src/services/__tests__/traceProcessorConnectionModel.test.ts --runInBand`
- `npm --prefix backend run test -- src/agentv3/__tests__/claudeMcpServer.test.ts --runInBand`
- `npm --prefix backend run test -- src/services/__tests__/traceProcessorLeaseStore.test.ts --runInBand`
- `npm --prefix backend run test -- src/services/__tests__/traceProcessorLeaseProcessorRouting.test.ts --runInBand`
- `npm --prefix backend run test -- src/services/__tests__/workingTraceProcessor.enterpriseIsolation.test.ts --runInBand`
- built-dist contract e2e：
  `node -e "require('./backend/dist/services/traceProcessorConnectionModel.js')..."`
- multi-window browser e2e 使用 future comparison snapshot 验证。
