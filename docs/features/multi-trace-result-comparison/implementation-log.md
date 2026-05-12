<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# 多 Trace 分析结果对比实施记录

本文记录 `README.md` 第 9 节 TODO 的逐项验收证据。

## M0.1 Submodule 与插件源码

状态：完成。

验收证据：

- `git submodule update --init perfetto` 成功，`perfetto` checkout 到 gitlink `f28da9c872b7997c8f60ba67660a0e44d0d433c0`。
- 插件源码存在于 `perfetto/ui/src/plugins/com.smartperfetto.AIAssistant/`。
- 源码中可定位现有对比入口：`ai_panel.ts` 的 `referenceTraceId`、`renderTracePicker()`、`enterComparisonMode()`、`switchComparisonTrace()`，以及 `comparison_state_manager.ts`。
- prebuild bundle `frontend/v54.0-0cf3beb39/frontend_bundle.js` 中可定位同一组 SmartPerfetto 插件线索：`referenceTraceId`、`comparison_state_manager`、`getSmartPerfettoWindowId`、`PENDING_BACKEND_TRACE_KEY`。

结论：

- 当前 worktree 具备插件源码，可以继续做前端改动。
- `frontend/` prebuild 与 submodule 内插件源码在关键功能线索上对齐；后续 UI 改动仍必须按规则通过 `./scripts/update-frontend.sh` 刷新 prebuild。

## M0.2 `referenceTraceId` 现有入口清单

状态：完成。

验收证据：

- 前端入口集中在 `perfetto/ui/src/plugins/com.smartperfetto.AIAssistant/ai_panel.ts`：
  - `state.referenceTraceId` 是旧对比模式的权威状态。
  - Header 对比按钮会调用 `fetchAvailableTraces()`，再渲染旧 Trace Picker。
  - `renderTracePicker()` 展示的是可选 Trace，而不是已完成的分析结果快照。
  - `enterComparisonMode()` / `switchComparisonTrace()` 只写入一个 `referenceTraceId`。
  - `sendMessage()` 向 `/api/agent/v1/analyze` 请求体附加 `referenceTraceId`。
- 前端共享状态位于 `comparison_state_manager.ts`，状态模型仍是单个 `referenceTraceId`，并且 `types.ts` 里 `AIPanelState.referenceTraceId` 是 `string | null`。
- 后端路由入口在 `backend/src/routes/agentRoutes.ts`：
  - 请求体类型包含 `referenceTraceId?: string`。
  - `/api/agent/v1/analyze` 校验 `referenceTraceId` 不能等于当前 `traceId`，并要求 reference trace 可访问。
  - `runAgentDrivenAnalysis()` 把 `referenceTraceId` 继续传给 orchestrator。
- Runtime 入口：
  - `backend/src/agentv3/claudeRuntime.ts` 会为 `referenceTraceId` 构造 comparison session key 与 `ComparisonContext`。
  - `backend/src/agentOpenAI/openAiRuntime.ts` 也会在存在 `referenceTraceId` 时构造 comparison context，并把 session key 扩展为 `:ref:${referenceTraceId}`。
  - `backend/src/agent/core/orchestratorTypes.ts` 与 `backend/src/agentv3/types.ts` 都只表达一个 reference trace。
- MCP 工具入口在 `backend/src/agentv3/claudeMcpServer.ts`：
  - 只有存在 `referenceTraceId` 时才注册旧 comparison tools。
  - 旧工具为 `execute_sql_on`、`compare_skill`、`get_comparison_context`，目标侧固定为 `current` / `reference`。
- 文档入口：
  - `docs/reference/api.md` / `docs/reference/api.en.md` 记录了 `/api/agent/v1/analyze` 的 `referenceTraceId` 参数。
  - `docs/reference/mcp-tools.md` / `docs/reference/mcp-tools.en.md` 记录了旧 comparison tools 的启用条件。
  - `docs/architecture/technical-architecture.md` 记录了旧双 Trace 对比链路。

结论：

- 旧功能是“同一次 agent run 访问 current/reference 两条 raw trace”的能力，不是“多个窗口、多用户、已完成分析结果快照”的能力。
- 新功能可以借鉴权限校验、工具注册和 UI 入口命名，但不能复用旧 `referenceTraceId` 作为产品模型或持久化模型。
