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

1. 现状审计。
   - 明确每个 `traceId` 对应的 process、RPC endpoint、worker queue、stdlib
     preload 状态。
   - 输出当前 session/trace/lease 生命周期图。

2. Contract 命名。
   - 在 backend 内部显式区分：
     - `TraceProcessorLease`
     - `TraceProcessorConnection`
     - `TraceProcessorDatabaseScope`
   - 不要求 C++ TP 直接暴露同名对象，但 backend contract 要对齐概念。

3. 多 Trace 查询边界。
   - 保持 `execute_sql_on(trace, sql)` 明确指定 side。
   - 不允许 implicit current/reference 混用。
   - 对 comparison tool 记录每个 result 的 trace side 和 traceId。

4. xConnect 研究原型。
   - 先做实验脚本，不进默认产品路径。
   - 验证 cross-connection 查询是否适合 SmartPerfetto 的 remote RPC/worker
     模式。

5. Pool/lease 验证。
   - 增加 same-page second trace、cross-window two traces、reference trace 的回归。
   - 保证 backend-created lease 和普通 UI FILE/URL trace engine 不互相覆盖。

## 测试

- `npm --prefix backend run test -- src/services/__tests__/traceProcessorLeaseStore.test.ts --runInBand`
- `npm --prefix backend run test -- src/services/__tests__/traceProcessorLeaseProcessorRouting.test.ts --runInBand`
- `npm --prefix backend run test -- src/services/__tests__/workingTraceProcessor.enterpriseIsolation.test.ts --runInBand`
- multi-trace e2e 使用 future comparison snapshot 验证。
