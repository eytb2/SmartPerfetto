<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# 多 Trace 分析结果对比 Feature 计划

## 1. 文档定位

本文定义一个新的 SmartPerfetto 功能：用户在两个或多个独立 Perfetto UI
窗口中分别打开、分析不同 Trace 后，可以把这些 Trace 的**分析结果**放在一起对比。

这个功能不以旧的单界面 `referenceTraceId` 对比为基础。旧功能是在一个 AI
Panel 中选择参考 Trace，然后让同一次 agent run 同时访问 current/reference
两条 Trace。新功能的核心对象不是“另一条 Trace”，而是“另一个窗口、另一次
AI 分析已经产出的结果快照”。旧功能边界见
[legacy-reference-trace-boundary.md](legacy-reference-trace-boundary.md)。

## 2. 目标体验

典型使用方式：

1. 用户在窗口 A 打开 Trace A，完成启动性能分析。
2. 用户在窗口 B 打开 Trace B，完成启动性能或滑动性能分析。
3. 用户回到窗口 A，说：“把当前 Trace 的结果和另外一个 Trace 的分析结果对比一下，重点看启动速度和 FPS。”
4. SmartPerfetto 自动识别“当前结果”和“另一个可比较结果”；如果有多个候选，提示用户选择。
5. AI 输出结构化 delta 表、关键差异解释、证据来源和后续建议。

目标能力：

- 支持 2 个 Trace 的结果对比，架构上支持扩展到 N 个 Trace。
- 支持跨窗口，窗口之间不共享 AI 会话状态。
- 支持多用户与 workspace 隔离，不允许跨 tenant/workspace 泄露结果。
- 对比对象是已完成或已保存的分析结果；不要求两个 Trace 同时处于同一个 Perfetto UI。
- 优先复用已经产出的结构化结果，缺失指标时再按需回查原 Trace。
- AI 负责解释和归因，但数值、单位、来源和缺失原因必须由结构化数据约束。

非目标：

- 不把多个 Trace 强塞到同一个 Perfetto timeline 中展示。
- 不要求两个窗口共享同一个 agent session。
- 不把旧的 `current/reference` 工具扩展成更多 hardcoded 槽位。
- 不用前端 `localStorage/sessionStorage` 作为跨窗口结果对比的权威状态。

## 3. 现状判断

当前代码里已经存在“双 Trace 对比”能力，但产品语义不同：

- 前端 AI Panel 有 `referenceTraceId`、Trace Picker 和“对比滑动/对比启动/对比帧率/对比 CPU”预设问题。
- 前端请求 `/api/agent/v1/analyze` 时，如果进入对比模式，会把 `referenceTraceId` 放到请求体里。
- 后端 `agentRoutes.ts` 校验 `referenceTraceId`，并把它传给 runtime。
- Claude/OpenAI runtime 都会构造 `ComparisonContext`，再注册 `compare_skill`、`execute_sql_on`、`get_comparison_context` 这 3 个 comparison tools。
- 这些工具只有 `current` 和 `reference` 两个固定侧，并且依赖同一次 agent run 的上下文。

这部分只用于说明现有边界，不能成为新功能的产品模型。新功能必须补齐这些缺口：

| 缺口 | 当前模型 | 新功能需要 |
|---|---|---|
| 对比对象 | raw trace + 同 run referenceTraceId | 已完成分析结果快照 |
| 作用域 | 当前 AI Panel 发起的一次请求 | workspace 内多个窗口/多个用户可见的结果目录 |
| 数量 | 固定 2 条，`current/reference` | 2 条起步，N 条可扩展 |
| 状态权威 | 前端会话状态 + 后端 live run | 后端 DB 中的结果快照与 comparison run |
| 可恢复性 | 依赖当前 trace processor 与当前会话 | backend restart 后仍可从快照重建对比 |
| 权限 | trace 可访问校验 | result/report/session/run 全链路 owner guard |
| 结果质量 | agent 即时查询两边 raw data | 标准化 metric schema + AI 解释 |

## 4. 核心概念

### 4.1 Analysis Result Snapshot

每次 AI 分析完成后生成一个可比较的结果快照。快照不是完整聊天记录的简单拷贝，而是面向对比的、结构化的安全摘要。

建议字段：

```typescript
interface AnalysisResultSnapshot {
  id: string;
  tenantId: string;
  workspaceId: string;
  traceId: string;
  sessionId: string;
  runId: string;
  reportId?: string;
  createdBy?: string;
  visibility: 'private' | 'workspace';
  sceneType: 'startup' | 'scrolling' | 'interaction' | 'memory' | 'cpu' | 'general';
  title: string;
  userQuery: string;
  traceLabel: string;
  traceMetadata: TraceComparisonMetadata;
  summary: AnalysisSummary;
  metrics: NormalizedMetricValue[];
  evidenceRefs: EvidenceRef[];
  status: 'ready' | 'partial' | 'failed';
  schemaVersion: 'analysis_result_snapshot@1';
  createdAt: number;
  expiresAt?: number;
}
```

### 4.2 Normalized Metric

对比必须围绕稳定 metric key 展开，而不是让 LLM 从自然语言报告里自由抽数值。

```typescript
interface NormalizedMetricValue {
  key: string;                 // startup.total_ms, scrolling.avg_fps
  label: string;               // 启动总耗时, 平均 FPS
  group: string;               // startup, fps, jank, cpu, memory
  value: number | string | null;
  unit?: 'ms' | 'fps' | '%' | 'count' | 'bytes' | 'ns';
  direction?: 'lower_is_better' | 'higher_is_better' | 'neutral';
  aggregation?: 'p50' | 'p90' | 'p99' | 'avg' | 'max' | 'sum' | 'single';
  confidence: number;
  missingReason?: string;
  source: {
    type: 'skill' | 'sql' | 'agent_conclusion' | 'report' | 'manual';
    skillId?: string;
    stepId?: string;
    dataEnvelopeId?: string;
    reportId?: string;
    messageId?: string;
  };
}
```

首批必须支持的 metric key：

| 场景 | Metric |
|---|---|
| 启动 | `startup.total_ms`, `startup.first_frame_ms`, `startup.bind_application_ms`, `startup.activity_start_ms`, `startup.main_thread_blocked_ms` |
| FPS/Jank | `scrolling.avg_fps`, `scrolling.frame_count`, `scrolling.jank_count`, `scrolling.jank_rate_pct`, `scrolling.p50_frame_ms`, `scrolling.p95_frame_ms`, `scrolling.p99_frame_ms` |
| CPU | `cpu.main_thread_running_ms`, `cpu.main_thread_runnable_ms`, `cpu.big_core_pct`, `cpu.avg_freq_mhz` |
| 环境 | `trace.duration_ms`, `trace.device_model`, `trace.android_version`, `trace.capture_config_summary` |

### 4.3 Comparison Run

对比本身也是一次可审计的 backend run。

```typescript
interface MultiTraceComparisonRun {
  id: string;
  tenantId: string;
  workspaceId: string;
  createdBy?: string;
  inputSnapshotIds: string[];
  baselineSnapshotId?: string;
  query: string;
  metricKeys?: string[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'needs_selection';
  result?: ComparisonResult;
  reportId?: string;
  createdAt: number;
  completedAt?: number;
}
```

输出必须包含：

- 输入结果清单：trace、session、run、分析问题、时间、可见性。
- Delta 表：metric、baseline、candidate(s)、变化值、变化百分比、方向评估。
- 缺失矩阵：哪些结果没有该指标，为什么缺失。
- 证据引用：每个关键数值来自哪个 snapshot metric / Skill step / report。
- AI 解释：只解释结构化数据能支持的差异，明确推断与不确定性。

## 5. 产品交互计划

### 5.1 结果保存

每次 agent run 到达 `analysis_completed` 后，后端自动创建 `AnalysisResultSnapshot`：

- 默认 `visibility = private`。
- 用户可以在结果菜单里改为 workspace 可见。
- 快照标题默认来自 trace 名称、sceneType 和用户问题，也允许用户重命名。
- 如果结果缺少标准化指标，快照仍保存为 `partial`，并记录缺失原因。

### 5.2 结果选择

AI Panel 新增“结果对比”入口：

- 当前窗口显示“当前 Trace 最近一次可比较结果”。
- 右侧或弹窗列出同 workspace 可读的结果快照。
- 列表按 active windows、同 trace、同 scene、最近时间排序。
- 用户输入“另外一个 Trace”时，如果当前 workspace 只有一个高置信候选，直接使用；否则进入选择状态。

候选排序建议：

1. 同 workspace、同 user 当前打开的其他窗口。
2. 同 sceneType 的最近完成结果。
3. 同 app/package/device/build 的结果。
4. workspace 可见结果。
5. 其他可读但 scene 不同的结果，默认折叠。

### 5.3 对比展示

对比结果用一个独立视图展示，不混在普通聊天消息里：

- 顶部：输入结果 chips，标明 baseline/candidate。
- 中部：metric delta table，可按场景分组。
- 下部：AI 解释、证据链、缺失项和建议。
- 每个证据都能跳转到原 report 或原 session；如果原 Trace 当前在线，再提供“在对应窗口定位”的后续能力。

N Trace 视图：

- 表格列为各个 Trace，首列为 metric。
- baseline 只影响 delta 计算，不影响原始值展示。
- 支持“对比全部”和“只看显著变化”两种过滤。

## 6. 后端架构计划

### 6.1 新增持久化表

建议在企业 DB schema 上新增这些表；单机模式也通过同一 repository 使用默认 tenant/workspace。

```sql
analysis_result_snapshots(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  report_id TEXT,
  created_by TEXT,
  visibility TEXT NOT NULL,
  scene_type TEXT NOT NULL,
  title TEXT NOT NULL,
  user_query TEXT NOT NULL,
  trace_label TEXT NOT NULL,
  trace_metadata_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  status TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);

analysis_result_metrics(
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_group TEXT NOT NULL,
  label TEXT NOT NULL,
  value_json TEXT,
  numeric_value REAL,
  unit TEXT,
  direction TEXT,
  aggregation TEXT,
  confidence REAL NOT NULL,
  missing_reason TEXT,
  source_json TEXT NOT NULL,
  FOREIGN KEY(snapshot_id) REFERENCES analysis_result_snapshots(id) ON DELETE CASCADE
);

analysis_result_evidence_refs(
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  ref_type TEXT NOT NULL,
  ref_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(snapshot_id) REFERENCES analysis_result_snapshots(id) ON DELETE CASCADE
);

multi_trace_comparison_runs(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_by TEXT,
  baseline_snapshot_id TEXT,
  query TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  report_id TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

multi_trace_comparison_inputs(
  comparison_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  role TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY(comparison_id, snapshot_id)
);
```

关键索引：

- `analysis_result_snapshots(tenant_id, workspace_id, trace_id, created_at)`
- `analysis_result_snapshots(tenant_id, workspace_id, scene_type, created_at)`
- `analysis_result_snapshots(tenant_id, workspace_id, visibility, created_at)`
- `analysis_result_metrics(snapshot_id, metric_key)`
- `multi_trace_comparison_runs(tenant_id, workspace_id, created_at)`

### 6.2 Repository 与 owner guard

新增 `AnalysisResultSnapshotRepository`：

- 所有查询都必须带 `tenantId/workspaceId/userId/roles`。
- private 结果仅创建者可读；workspace 结果按 RBAC 可读。
- 删除 trace/session/report 时，快照进入 tombstone 或级联删除，不能留下孤儿证据链接。
- 每次读取、创建、对比、分享、删除都写 audit event。

新增权限：

- `analysis_result:read`
- `analysis_result:create`
- `analysis_result:share`
- `analysis_result:delete`
- `comparison:create`
- `comparison:read`

### 6.3 Snapshot 生成管线

在 `analysis_completed` 链路后追加异步但可靠的 snapshot 生成：

```text
agent run completed
  -> report generated
  -> collect persisted run events / DataEnvelopes / report metadata
  -> AnalysisResultNormalizer.extract()
  -> persist AnalysisResultSnapshot + metrics + evidence refs
  -> emit snapshot_created SSE event
```

不要只依赖前端消息内容。后端应从这些来源抽取：

- `agent_events` 中的 `agent_response` / DataEnvelope payload。
- report artifact metadata。
- session/run metadata。
- runtime 已知的 sceneType、traceId、provider snapshot。
- 必要时读取原 Skill display contract。

### 6.4 对比执行管线

新增 comparison API：

```text
POST /api/workspaces/:workspaceId/comparisons
GET  /api/workspaces/:workspaceId/comparisons/:comparisonId
GET  /api/workspaces/:workspaceId/comparisons/:comparisonId/stream
GET  /api/workspaces/:workspaceId/analysis-results
GET  /api/workspaces/:workspaceId/analysis-results/:snapshotId
PATCH /api/workspaces/:workspaceId/analysis-results/:snapshotId
```

请求示例：

```json
{
  "query": "对比启动速度和 FPS",
  "baselineSnapshotId": "result-a",
  "candidateSnapshotIds": ["result-b", "result-c"],
  "metricKeys": ["startup.total_ms", "scrolling.avg_fps", "scrolling.jank_rate_pct"],
  "allowTraceBackfill": true
}
```

执行步骤：

1. 校验所有 snapshot 可读、同 workspace，数量 2 到 N。
2. 构造 `ComparisonMatrix`。
3. 对缺失但可回填的 metric，按 `allowTraceBackfill` 和资源预算决定是否查询原 Trace。
4. 启动一个 comparison run，复用当前 Provider/runtime 选择。
5. Runtime 只拿结构化 matrix、summary 和证据引用，不直接拿完整聊天记录。
6. 生成 comparison report，并持久化到 `multi_trace_comparison_runs.result_json` 与 report artifact。

### 6.5 Trace 回填策略

默认优先对比快照，不唤醒 trace processor。只有这些情况才回查原 Trace：

- 用户显式要求某个 snapshot 没有的 metric。
- metric 属于首批标准指标，且原 trace 仍可访问。
- quota/RAM/lease 允许。
- 回填过程能给出清晰来源。

回填不是旧 `compare_skill` 的 N trace 版本，而是逐个 snapshot 补齐标准 metric：

```text
missing startup.total_ms for result-b
  -> acquire read-only lease for trace-b
  -> run startup metric extractor
  -> append metric to result-b snapshot with source=backfill
  -> continue comparison
```

## 7. AI 与 Skill 计划

### 7.1 新 MCP 工具

新增供 agent 使用的结果对比工具：

| Tool | 用途 |
|---|---|
| `list_analysis_results` | 按 workspace、trace、scene、owner、active window 查询可比较结果 |
| `get_analysis_result` | 读取单个 snapshot 的 summary、metrics、evidence refs |
| `build_comparison_matrix` | 从 2-N 个 snapshot 构造 delta matrix |
| `backfill_result_metric` | 对单个 snapshot 回查原 Trace 并补齐某个标准 metric |
| `write_comparison_result` | 提交最终 comparison result 与 report metadata |

这些工具应注册为 comparison run 专用工具，不暴露给普通单 Trace 分析路径。

### 7.2 新 Skill

需要新增一个面向“结果快照”的 Skill，而不是面向单条 Trace SQL 的 Skill：

- `backend/skills/comparison/multi_trace_result_comparison.skill.yaml`
- 输入：`snapshot_ids`, `baseline_snapshot_id`, `metric_keys`, `query`
- 输出：`ComparisonMatrix` DataEnvelope、缺失矩阵、显著变化列表。

如果现有 Skill DSL 只适合 trace SQL，则先实现 `ComparisonMatrixService`，再扩展 Skill DSL 支持 `source: analysis_result_snapshot`。不要为了赶进度把复杂 prompt 写进 TypeScript。

同时新增 prompt/strategy 资源：

- `backend/strategies/multi-trace-result-comparison.strategy.md`
- `backend/strategies/comparison-result-methodology.template.md`

方法论要求：

- 先确认输入结果是否可比。
- 只对结构化 metric 做定量结论。
- 对不同场景、不同设备、不同采集配置明确降级。
- 每个关键结论引用 snapshot/metric/evidence。
- AI 可以解释原因，但必须标注“已验证事实”和“推断”。

## 8. 前端计划

### 8.1 Window 上下文

现有前端已经有 `windowId` 和 workspace context。新功能应把当前窗口状态注册到后端：

```text
POST /api/workspaces/:workspaceId/windows/:windowId/heartbeat
{
  traceId,
  backendTraceId,
  activeSessionId,
  latestSnapshotId,
  traceTitle,
  sceneType,
  updatedAt
}
```

用途：

- 支持“另一个 Trace”自然语言解析。
- 排序候选结果。
- 未来支持从对比证据跳回对应窗口。

### 8.2 Result Picker

新增结果选择器，不复用旧 Trace Picker：

- 展示结果而不是 Trace 文件。
- 同一个 Trace 可以有多次分析结果。
- 标明 scene、query、完成时间、owner、visibility、metric 覆盖率。
- 支持选择 1 个 baseline 和多个 candidates。
- 支持 “保存当前结果用于对比 / 设为 workspace 可见”。

### 8.3 Chat 触发

用户说这些话时进入结果对比流程：

- “把当前 Trace 的结果和另一个 Trace 对比”
- “对比两个 Trace 的启动速度”
- “对比 A/B/C 三次测试的 FPS”
- “当前结果和昨天那条 Trace 的分析结果有什么差别”

如果候选唯一：

```text
frontend -> POST /comparisons
```

如果候选不唯一：

```text
assistant message -> needs_selection
Result Picker -> POST /comparisons
```

### 8.4 与旧对比入口的关系

旧入口可以保留，但文案需要区分：

- 旧：`Trace 实时对比`，适合当前窗口里临时选一条 reference Trace，让 AI 同时查两边 raw data。
- 新：`分析结果对比`，适合多个窗口/多用户已经完成的分析结果。

默认推荐新入口。旧入口后续可以隐藏到高级菜单。

## 9. 实施里程碑

### M0: 事实审计与源码补齐

- [x] 初始化或同步 `perfetto/` submodule，确认插件源码与 `frontend/` prebuild 一致。
- [x] 列出当前 `referenceTraceId` 相关前端源码、后端路由、runtime 工具与 docs。
- [x] 确认 `agent_events` 中 DataEnvelope 的持久化粒度是否足够生成 snapshot。
- [x] 确认 report artifact 与 session/run metadata 是否能稳定反查。
- [x] 补一份旧功能边界说明，避免后续误把旧 compare 当新功能复用。

### M1: Snapshot Contract 与持久化

- [x] 新增 TypeScript contract：`AnalysisResultSnapshot`, `NormalizedMetricValue`, `ComparisonMatrix`。
- [x] 新增 DB migration 与 repository。
- [x] 在 `analysis_completed` 后生成 snapshot。
- [x] 从 startup/scrolling 结果里抽取首批标准 metric。
- [x] 增加 `snapshot_created` SSE event。
- [x] 增加 owner guard、visibility、audit。

验收：

- 完成一次启动分析后，DB 中出现 ready/partial snapshot。
- backend restart 后仍能列出 snapshot。
- 非同 workspace 用户无法读取 snapshot。

### M2: 结果目录与 Picker

- [x] 新增 `GET /analysis-results` API。
- [x] 前端显示当前窗口最近 snapshot。
- [x] 新增 Result Picker。
- [x] 支持把 private snapshot 改成 workspace 可见。
- [x] 注册 window heartbeat，用于“另一个 Trace”候选排序。

验收：

- 两个窗口分别完成分析后，任一窗口能看到另一个可读结果。
- 多个候选时不会擅自选择，必须让用户确认。
- 切 workspace 后结果目录隔离。

### M3: Comparison Run MVP

- [ ] 新增 comparison repository/API/SSE。
- [ ] 新增 `build_comparison_matrix` 服务。
- [ ] 支持 2 个 snapshot 的启动/FPS/Jank metric 对比。
- [ ] 生成 AI comparison conclusion。
- [ ] 生成 HTML comparison report。

验收：

- 用户在窗口 A 发起“对比当前结果和窗口 B 的结果”，能得到 delta 表。
- 不要求窗口 B 仍处于打开状态。
- 不要求两个 trace processor 同时 active。
- 输出中每个关键数值都有来源。

### M4: Metric Backfill 与新 Skill

- [ ] 实现标准 metric backfill。
- [ ] 对回填路径接入 TraceProcessorLease。
- [ ] 新增 `multi_trace_result_comparison` Skill 或等价 Skill DSL 扩展。
- [ ] 新增 comparison strategy/template。
- [ ] 支持用户要求的自定义 metric keys。

验收：

- snapshot 缺少 `scrolling.avg_fps` 时，允许回查原 Trace 并补齐。
- 回填失败时 comparison 仍完成，但标注缺失原因。
- Skill/strategy 校验通过。

### M5: N Trace 与高级 UX

- [ ] 支持 3 个以上 snapshot。
- [ ] 支持 baseline 切换。
- [ ] 支持“只看显著变化”。
- [ ] 支持按 metric group 折叠。
- [ ] 支持导出 comparison report。

验收：

- 3 条启动测试结果可以输出横向矩阵。
- baseline 变化后 delta 重新计算。
- 报告可持久化、可分享、可受权限控制。

## 10. 测试计划

Unit：

- Snapshot normalizer: startup、scrolling、missing metrics、单位转换、confidence。
- Comparison matrix: 数值 delta、百分比 delta、方向评估、N trace、缺失项。
- Repository owner guard: private/workspace/tenant/workspace 隔离。
- Candidate ranking: active window、same scene、same app、recentness。

Integration：

- 两个不同 trace 分别完成分析后生成两个 snapshots。
- backend restart 后仍可对比。
- 删除 trace/session/report 后 snapshot 行为正确。
- comparison run SSE 支持 replay。
- 非授权用户读取 snapshot/comparison 返回 404 或 forbidden。

Frontend：

- 两个 Perfetto UI 窗口分别分析，Result Picker 能列出对方结果。
- “另外一个 Trace”唯一候选自动发起，对多个候选进入选择状态。
- 切 workspace 后当前窗口结果、候选结果、comparison 状态全部重置。
- 对比中断后刷新页面能恢复 comparison report。

E2E：

- 启动性能 A/B 对比。
- 滑动 FPS/Jank A/B 对比。
- A/B/C 三次结果对比。
- 一个 snapshot 缺失指标，触发 backfill。
- 两个用户同 workspace 可共享 workspace visible 结果。
- 两个用户不同 workspace 互不可见。

回归门禁：

- Docs-only 阶段：`git diff --check`。
- Skill 改动：`cd backend && npm run validate:skills`。
- Strategy/template 改动：`cd backend && npm run validate:strategies`。
- Agent/runtime/API 改动：`cd backend && npm run test:scene-trace-regression`。
- PR 收口：仓库根目录 `npm run verify:pr`。

## 11. 风险与决策点

| 风险 | 处理 |
|---|---|
| LLM 从旧报告文本里误抽数值 | 数值只来自 `NormalizedMetricValue`，自然语言仅作辅助摘要 |
| 不同场景强行对比 | sceneType 不一致时降级，只展示环境/通用指标 |
| 不同设备/采集配置导致不可比 | traceMetadata 中显式展示，AI 输出必须标注 |
| snapshot 太大 | 只存 summary、metrics、evidence refs；完整报告仍在 report artifact |
| 用户说“另一个 Trace”不明确 | 候选唯一才自动选择，否则进入 Result Picker |
| 多用户泄露结果 | repository 层强制 owner guard，默认 private |
| 回填唤醒太多 trace processor | 默认不回填；回填走 quota、lease、RAM budget |
| 新旧 compare 混淆 | UI 文案和 API 分层：旧是 Trace 实时对比，新是分析结果对比 |

## 12. 推荐开发顺序

先做 M1 和 M3 的最小闭环，不先做复杂 UI：

1. 后端 snapshot contract + startup/scrolling metric normalizer。
2. 用 API 手工创建两个 snapshot 并跑 comparison matrix。
3. 接入 AI comparison conclusion。
4. 再做 Result Picker 和 window heartbeat。
5. 最后做 backfill、N trace 和高级交互。

这个顺序能先证明最关键的产品假设：**跨窗口结果对比应该依赖后端持久化的分析结果快照，而不是依赖某个 Perfetto UI 实例当前还活着。**
