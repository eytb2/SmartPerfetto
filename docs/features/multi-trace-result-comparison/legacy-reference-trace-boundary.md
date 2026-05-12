<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# 旧 `referenceTraceId` 对比功能边界

本文只定义旧功能边界，避免多 Trace 分析结果对比实现时误复用旧模型。

## 旧功能是什么

旧功能是单个 Perfetto UI / 单个 AI Panel 内的实时双 Trace 对比：

1. 用户在当前 AI Panel 里选择一个 reference trace。
2. 前端把 `referenceTraceId` 附加到 `/api/agent/v1/analyze` 请求体。
3. 后端校验 current trace 与 reference trace 都可访问。
4. Runtime 为同一次 agent run 构造 `ComparisonContext`。
5. MCP server 只在存在 `referenceTraceId` 时注册 comparison tools。
6. Agent 在一次 run 内使用 `current` / `reference` 两个固定侧查询 raw trace。

这个模型的核心对象是 trace，不是已经完成的分析结果。

## 旧功能可以继续保留的职责

- 临时、即时地比较当前 trace 与一个 reference trace。
- 允许 agent 同时查询两条 raw trace。
- 适合用户还没有生成分析报告、只想快速问一句“这两个 trace 哪个更慢”的场景。
- 继续使用 `execute_sql_on`、`compare_skill`、`get_comparison_context` 这类 current/reference 工具。

## 新功能不能复用的部分

- 不能把 `referenceTraceId` 当作新功能的输入模型。新功能输入必须是 `snapshotId[]`。
- 不能用前端状态作为跨窗口权威状态。新功能权威状态必须落在 backend DB。
- 不能假设只有两个对象。新功能从 2 个结果起步，但 contract 和 matrix 必须支持 N 个。
- 不能要求两个 trace processor 同时 active。新功能优先对比 snapshot，缺失 metric 时才按预算回填。
- 不能让 runtime 直接读取完整聊天记录后自由抽数值。定量结论必须来自 `NormalizedMetricValue`。
- 不能把旧 `current/reference` 工具扩成 `traceA/traceB/traceC`。N Trace 需要结果快照与矩阵服务。

## 可以借鉴的工程资产

- trace 可访问校验方式。
- tenant/workspace owner guard 的传参方式。
- SSE replay 与 agent event 持久化模式。
- report artifact 的持久化与权限检查模式。
- UI 入口的 discoverability，但文案必须区分：
  - 旧功能：`Trace 实时对比`
  - 新功能：`分析结果对比`

## 新旧功能关系

短期内两个功能并存：

- 默认推荐 `分析结果对比`，覆盖多窗口、多用户、已完成分析结果的对比体验。
- `Trace 实时对比` 保留为高级入口，覆盖临时 raw trace 查询场景。

长期可以根据使用情况决定是否隐藏旧入口，但旧入口不应阻塞新功能的 contract、DB schema、API、Skill 和 UX 设计。
