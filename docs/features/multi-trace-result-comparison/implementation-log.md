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

## M1.1 TypeScript Contract

状态：完成。

验收证据：

- 新增 `backend/src/types/multiTraceComparison.ts`。
- 新增并导出：
  - `AnalysisResultSnapshot`
  - `NormalizedMetricValue`
  - `EvidenceRef`
  - `ComparisonMatrix`
  - `ComparisonResult`
  - `MultiTraceComparisonRun`
- 定义首批标准 metric key 与 `STANDARD_COMPARISON_METRICS`，覆盖 startup、scrolling/FPS/Jank、CPU、trace environment。
- `backend/src/types/index.ts` 已导出该 contract。

结论：

- M1 后续 DB schema、repository、normalizer、API、comparison matrix 服务都应引用该 contract，不再复制临时 shape。

## M1.2 DB Migration 与 Repository

状态：完成。

验收证据：

- `backend/src/services/enterpriseSchema.ts` 新增 migration v7。
- 新增表：
  - `analysis_result_snapshots`
  - `analysis_result_metrics`
  - `analysis_result_evidence_refs`
- 新增索引覆盖 trace、scene、visibility、owner guard、run、metric key、evidence refs。
- `backend/src/services/enterpriseRepository.ts` 的 workspace scoped table 清单已纳入 `analysis_result_snapshots`。
- 新增 `backend/src/services/analysisResultSnapshotStore.ts`，支持 create/get/list/updateVisibility/delete，并按 tenant/workspace/user/visibility 过滤。
- 新增 `backend/src/services/__tests__/analysisResultSnapshotStore.test.ts`。
- 更新 `enterpriseSchema` / `enterpriseRepository` 单元测试覆盖新表和清单。

结论：

- Snapshot 主表已经具备 owner guard 查询边界。
- Metrics/evidence 作为 snapshot 子表级联删除，不直接暴露 workspace scoped repository。

## M1.3 `analysis_completed` 后生成 Snapshot

状态：完成。

验收证据：

- 新增 `backend/src/services/analysisResultSnapshotPipeline.ts`。
- `buildCompletedAnalysisResultSnapshot()` 从 tenant/workspace/session/run/report/query/conclusion/DataEnvelope metadata 构造 `AnalysisResultSnapshot`。
- 首版生成 `partial` snapshot，原因包含 `No normalized comparison metrics extracted yet`；标准 metric 抽取留给 M1.4。
- `persistCompletedAnalysisResultSnapshot()` 通过 enterprise DB 与 `AnalysisResultSnapshotRepository` 写入 snapshot。
- `backend/src/routes/agentRoutes.ts` 在 report 生成结束后、`analysis_completed` SSE 发送前调用 snapshot 持久化。
- `analysis_completed` payload 增加 `resultSnapshotId`，便于后续前端显示当前窗口最近 snapshot。
- 新增 `backend/src/services/__tests__/analysisResultSnapshotPipeline.test.ts`。

结论：

- 完成一次 agent run 后，后端会尝试持久化一个可比较的结果快照。
- 如果缺少 tenant/workspace/run 元数据或 DB 写入失败，当前分析完成链路不会被 snapshot 失败阻断。

## M1.4 Startup/Scrolling 标准 Metric 抽取

状态：完成。

验收证据：

- `analysisResultSnapshotPipeline.ts` 新增 DataEnvelope payload rows 解析。
- 支持从结构化行/列抽取首批标准 metric：
  - startup: `startup.total_ms`、`startup.first_frame_ms`、`startup.bind_application_ms`、`startup.activity_start_ms`、`startup.main_thread_blocked_ms`
  - scrolling: `scrolling.avg_fps`、`scrolling.frame_count`、`scrolling.jank_count`、`scrolling.jank_rate_pct`、`scrolling.p50_frame_ms`、`scrolling.p95_frame_ms`、`scrolling.p99_frame_ms`
  - CPU/trace 环境字段也预留在同一 extractor 中，供后续 backfill/API 复用。
- `scrolling.jank_rate_pct` 会把 `0..1` 的 fractional rate 转为百分比。
- 有标准 metric 时 snapshot 状态为 `ready`；抽不到标准 metric 时保持 `partial` 并记录缺失原因。
- `analysisResultSnapshotPipeline.test.ts` 覆盖 startup metric、scrolling FPS/Jank metric 和 no-metric partial fallback。

结论：

- Snapshot 生成不再只是 report/session/run 索引；已经能从 startup/scrolling DataEnvelope 中提取可比较数值。

## M1.5 `snapshot_created` SSE Event

状态：完成。

验收证据：

- `backend/src/types/dataContract.ts` 的 `SSE_EVENT_TYPES` 新增 `snapshot_created`。
- `backend/src/types/analysis.ts` 的 `SSEEventType` 新增 `SNAPSHOT_CREATED`。
- `backend/src/routes/agentRoutes.ts` 在 snapshot 持久化成功后发送可重放 `snapshot_created` event。
- `snapshot_created` payload 包含 `snapshotId`、`status`、`sceneType`、`metricCount`、`evidenceRefCount`、`traceId`、`sessionId`、`runId`、`reportId`、`visibility`、`createdAt`。
- `analysis_completed` 仍保留 `resultSnapshotId`，兼容只监听 terminal event 的客户端。

结论：

- 前端后续可以通过 `snapshot_created` 更新“当前窗口最近 snapshot”，刷新或 SSE 重连也可以通过 `agent_events` replay 恢复该事件。

## M1.6 Owner Guard、Visibility、Audit

状态：完成。

验收证据：

- `AnalysisResultSnapshotRepository` 所有读写都带 `tenantId/workspaceId/userId` scope。
- private snapshot 只有创建者或 system-owned 结果可读；workspace snapshot 对同 workspace 可读用户可见。
- `createSnapshot()`、`getSnapshot()`、`listSnapshots()`、`updateVisibility()`、`deleteSnapshot()` 都会写入 audit event。
- `backend/src/services/rbac.ts` 新增权限：
  - `analysis_result:read`
  - `analysis_result:create`
  - `analysis_result:share`
  - `analysis_result:delete`
  - `comparison:create`
  - `comparison:read`
- RBAC helper 新增 analysis result read/create/share/delete 判定。
- `rbac.test.ts` 覆盖 role 权限、scope implication、private/workspace visibility owner guard。

结论：

- M2 API 层可以直接复用 repository + RBAC helper，避免在 route 中重新手写隔离规则。

## M2.1 `GET /analysis-results` API

状态：完成。

验收证据：

- 新增 `backend/src/routes/analysisResultRoutes.ts`。
- 新增 workspace-scoped route：`GET /api/workspaces/:workspaceId/analysis-results`。
- API 支持 `traceId`、`sceneType`、`visibility`、`createdBy`、`limit` 查询参数。
- API 要求 `analysis_result:read` 权限，并通过 `AnalysisResultSnapshotRepository` 执行 tenant/workspace/user/visibility 过滤。
- `backend/src/index.ts` 已注册该 workspace-scoped route。
- 新增 `backend/src/routes/__tests__/analysisResultRoutes.test.ts` 覆盖列表、过滤、非法参数。

结论：

- M2 前端 Result Picker 已有后端结果目录接口可接入。

## M2.2 前端显示当前窗口最近 Snapshot

状态：完成。

验收证据：

- `types.ts` 新增 `LatestAnalysisSnapshot` 与 `AIPanelState.latestAnalysisSnapshot`。
- `ai_panel.ts` 初始化和 trace/workspace reset 时会清空 latest snapshot。
- `ai_panel.ts` 处理 `snapshot_created` SSE event，保存 `snapshotId/status/sceneType/metricCount/evidenceRefCount/trace/session/run/report/visibility/createdAt`。
- `analysis_completed.resultSnapshotId` 作为 fallback，避免客户端错过 `snapshot_created` 时完全丢失 snapshot id。
- Header 状态区新增 `Ready result` / `Partial result` chip，tooltip 展示 snapshot id、scene、metric count、visibility。
- `styles.scss` 新增 snapshot 状态 chip 样式。

结论：

- 当前窗口完成分析后，用户能在 AI Panel 顶部看到最近一次可比较分析结果是否已经持久化。

## M2.3 Result Picker

状态：完成。

验收证据：

- `buildSmartPerfettoWorkspaceApiUrl` 支持 `analysis-results` workspace resource。
- `types.ts` 新增 `AnalysisResultPickerItem`，并在 `AIPanelState` 中独立维护 Result Picker 可见性、加载错误、baseline、candidate 选择状态。
- AI Panel 顶部新增 `fact_check` 入口，和旧 `compare_arrows` Trace Picker 分离。
- Result Picker 拉取 `GET /api/workspaces/:workspaceId/analysis-results?limit=100`。
- Picker 列表展示 title、query、scene、trace label、完成时间、owner、visibility、metric/evidence 覆盖数量。
- Picker 支持 1 个 baseline 和多个 candidates，默认优先把当前窗口 latest snapshot 作为 baseline。
- 当前 M2 阶段只完成选择器与选择状态；真正创建 comparison run 留到 M3。

结论：

- 多窗口/多用户场景下，用户已经可以从 workspace 分析结果目录中选择一组待对比 snapshot。

## M2.4 Private Snapshot 改成 Workspace 可见

状态：完成。

验收证据：

- 后端新增 `PATCH /api/workspaces/:workspaceId/analysis-results/:snapshotId`。
- PATCH body 支持 `{ "visibility": "workspace" }` 和 `{ "visibility": "private" }`，非法 visibility 返回 400。
- 路由复用 `analysis_result:share` RBAC，并要求当前用户对目标 snapshot 有 owner 级写权限。
- Snapshot repository 复用 `updateVisibility`，更新后返回完整 snapshot 并记录审计事件。
- Result Picker 对 private snapshot 显示“共享”动作，成功后局部刷新 item，并同步 header latest snapshot 的 visibility。
- 增加 route test 覆盖成功更新和非法 visibility。

结论：

- 用户可以把自己的 private 分析结果发布到 workspace 结果目录，供其它窗口或用户作为对比候选。
