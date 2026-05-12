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

## M0.3 DataEnvelope 持久化粒度

状态：完成。

验收证据：

- `backend/src/services/enterpriseSchema.ts` 已有 `agent_events` 表，字段包含 `tenant_id`、`workspace_id`、`run_id`、`cursor`、`event_type`、`payload_json`、`created_at`，并有 `idx_agent_events_replay(run_id, cursor)` 与 `idx_agent_events_owner_guard(tenant_id, workspace_id, run_id, cursor)`。
- `backend/src/routes/agentRoutes.ts` 的 `broadcastToAgentDrivenClients()` 会为每个 streaming update 分配单调递增 `seqId`，通过 `streamProjector.broadcastStreamingUpdate()` 形成 SSE payload 后，在 `onBufferedEvent` 中调用 `persistBufferedAgentEvent()` 写入 DB。
- `backend/src/services/agentEventStore.ts` 的 `persistSerializedAgentEvent()` 以 `INSERT OR IGNORE` 写入完整 `payload_json`，terminal event 还会同步更新 `analysis_runs` / `analysis_sessions` 状态。
- `backend/src/assistant/stream/streamProjector.ts` 对 `data` event 的序列化格式为：
  - `type: 'data'`
  - `id`
  - `envelope: update.content`
  - `timestamp`
  - observability metadata
- `backend/src/types/dataContract.ts` 明确 `DataEvent.envelope` 是单个 `DataEnvelope` 或 `DataEnvelope[]`。
- `broadcastToAgentDrivenClients()` 同时会把有效 DataEnvelope 加入 `session.dataEnvelopes`，但该数组会被 `MAX_SESSION_DATA_ENVELOPES` 裁剪，只适合运行期 UI/report 派生，不适合作为持久化 snapshot 的唯一来源。

结论：

- `agent_events` 的粒度足够生成 snapshot：可以按 `tenant_id/workspace_id/run_id` 读取所有 `event_type = 'data'` 事件，再从 `payload_json.envelope` 恢复完整 DataEnvelope 和 display/source metadata。
- Snapshot normalizer 应优先读取 DB 中的 `agent_events`，只把内存 `session.dataEnvelopes` 当作当前 run 内的快速路径或 fallback。
- 需要新增一个按 `runId` 读取完整 DataEnvelope 的 helper，避免直接依赖 SSE ring buffer 或前端消息。

## M0.4 Report Artifact 与 Session/Run 反查

状态：完成。

验收证据：

- `backend/src/services/enterpriseSchema.ts` 的 `report_artifacts` 表包含 `tenant_id`、`workspace_id`、`session_id`、`run_id`、`local_path`、`visibility`、`created_by`、`created_at`、`expires_at`。
- `report_artifacts` 对 `(tenant_id, workspace_id, session_id)` 与 `(tenant_id, workspace_id, run_id)` 都有索引，并通过复合外键指向 `analysis_sessions` / `analysis_runs`。
- `analysis_sessions` 持有 `trace_id`、`created_by`、`title`、`visibility`、`status`、`created_at`、`updated_at`，并有 `idx_analysis_sessions_trace(tenant_id, workspace_id, trace_id, created_at)`。
- `analysis_runs` 持有 `session_id`、`mode`、`status`、`question`、`started_at`、`completed_at`、`heartbeat_at`、`updated_at`。
- `backend/src/routes/reportRoutes.ts` 的 `persistReport()` 在企业持久化开启时会调用 `persistEnterpriseReport()`：
  - `ensureEnterpriseReportGraph()` 会确保 tenant、workspace、trace、session、run 图存在。
  - `report_artifacts` 写入 `session_id/run_id` 和 `local_path`。
  - `report.json` sidecar 也记录 `reportId`、`sessionId`、`runId`、`traceId`、`tenantId`、`workspaceId`、`userId`、`visibility`。
- `backend/src/routes/agentRoutes.ts` 的 agent report 生成路径会把 `sessionId`、`runId`、`traceId`、`tenantId`、`workspaceId`、`userId`、`visibility` 传给 `persistReport()`。

结论：

- Snapshot 可以稳定保存 `reportId/sessionId/runId/traceId`：agent run 完成时这些字段都已经在 session、run、report artifact 图中可反查。
- `report_artifacts` 表本身不直接存 `trace_id`，需要通过 `report_artifacts.session_id -> analysis_sessions.trace_id` 反查；这是可接受的，但 snapshot repository 应在创建时把 `trace_id` 冗余存入 `analysis_result_snapshots`，避免列表查询频繁 join。
- 从 snapshot 回到 report 的路径应使用 `reportId`，从 snapshot 回到结构化证据的路径应使用 `runId -> agent_events`。

## M0.5 旧功能边界说明

状态：完成。

验收证据：

- 新增 `docs/features/multi-trace-result-comparison/legacy-reference-trace-boundary.md`。
- `README.md` 文档定位段落已链接该边界文档。
- 第 9 节 M0 最后一项已勾选。

结论：

- 旧 `referenceTraceId` 功能定义为单 AI Panel、单 run、current/reference raw trace 实时对比。
- 新功能定义为 backend DB 中的 `snapshotId[]` 分析结果对比，不复用旧产品模型。
