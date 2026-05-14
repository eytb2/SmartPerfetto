# 出图教学重构计划

## Summary

目标文档：`docs/features/rendering-pipeline-teaching-refactor/README.md`。

本重构把“出图教学”从“检测一个主管线 + 展示静态 Mermaid + 自动 pin track”升级为“基于当前 trace 的真实出图流程教学”。最终体验是：用户点“出图教学”后，SmartPerfetto 先把当前 trace 中可观测到的 App -> Framework -> RenderThread/Producer -> BufferQueue/Transaction -> SurfaceFlinger/HWC -> present 链路拼成顶部泳道和关键事件，再在下方解释这些事件在 Android 出图机制中的知识点、异常信号和采集缺口。

核心原则：

- 确定性事实优先：真实 slice、thread、process、layer、ts/dur、fence/present 证据由 SQL/Skill 产出。
- 教学解释其次：YAML/doc 只解释“已观测到的链路”，不把静态模板伪装成当前 trace 事实。
- 混合出图不单选：HWUI host、WebView/Flutter/RN/GL/TextureView/SurfaceView producer 分开展示，再合并依赖。
- 前端不做分析逻辑：前端只传上下文、渲染结构化结果、执行 pin/overlay，并展示成功/失败状态。

## 1. 背景与问题

现有“出图教学”功能能完成基础教学入口：检测渲染管线、拿到对应 YAML/doc 的 Mermaid、线程角色、关键 Slice，并生成一组 pin 指令。但它的核心问题是结果更像“静态管线说明”，不是“当前 trace 的真实出图流程”。

主要问题：

- 现状偏静态：用户看到的是某个 pipeline skill 的 Mermaid 和 keySlices，不一定对应当前 trace 中实际出现的事件顺序。
- 缺少当前 trace 链路：响应里没有结构化的 observed lanes/events，无法回答“这一次 trace 里 App 到 SurfaceFlinger 到 present 到底发生了什么”。
- 混合出图容易误导：当前 detection 会给出 `primary_pipeline_id`，但 WebView/Flutter/RN/GL/TextureView/SurfaceView 这类嵌入式或独立 producer 需要与 host HWUI 分开展示。
- API contract 分裂：类型文件偏 camelCase，route 实际返回存在 snake_case 兼容字段，前端只能按旧 markdown 方式拼接。
- route 聚合逻辑重复：`agentTeachingRoutes.ts` 内部重复拼装 detection、teaching、pin，和 SkillEngine 的 `pipeline_bundle` 聚合点不一致。
- pin 不可解释：前端收到 pin 指令后缺少结构化的成功/失败反馈，用户不知道哪些 track 被 pin、哪些没找到、哪些因为采集缺口无法展示。
- overlay 语义不足：`pipeline_key_slices_overlay` 当前是 key slice 查表能力，但还没有成为“真实 observed flow”的统一证据结构。

## 2. 目标体验

用户点击“出图教学”后，界面按三层展示：

1. 顶部真实泳道：展示当前 trace 中可观测到的 App、Framework、RenderThread、producer、BufferQueue/Transaction、SurfaceFlinger/HWC/present 角色。每条 lane 明确 process/thread/layer 标识、track hint、confidence 和证据来源。
2. 中部关键路径事件：按时间展示真实事件，包含 stage、slice/thread/process、ts/dur、durMs、evidence source、可选 related frame/layer。事件只来自 trace 查询结果，不由文档模板伪造。
3. 下方知识点：展示对应 pipeline 的 Mermaid、线程角色、关键 Slice、机制解释、异常信号和采集建议。知识点必须围绕已观测 lane/event 展开；缺失事件用 warnings 标注。

用户应该能直接看见：

- 当前 trace 的 host HWUI 链路是什么。
- 是否还有 WebView/Flutter/RN/GL/TextureView/SurfaceView producer。
- 哪些 lane 被 pin，哪些 track 没找到。
- 哪些关键事件真实存在，哪些因为 trace 配置缺失无法确认。
- 当前展示用的是 selection、visible window、package hint 还是 dominant process fallback。

## 3. 目标数据模型

### 3.1 Observed Flow

`observedFlow` 是结构化事实层，来自 SQL/Skill 的确定性证据。

```ts
interface ObservedFlow {
  schemaVersion: 'observed-flow.v1';
  context: {
    traceId: string;
    packageName?: string;
    timeRange?: { startTs: number; endTs: number; source: string };
    selection?: Record<string, unknown>;
    sourcePriority: string[];
    fallbackUsed?: string;
  };
  lanes: ObservedFlowLane[];
  events: ObservedFlowEvent[];
  dependencies: ObservedFlowDependency[];
  completeness: {
    level: 'high' | 'medium' | 'low';
    missingSignals: string[];
    warnings: string[];
  };
}
```

### 3.2 Pipeline Lanes

`observedFlow.lanes[]` 表示要拼到顶部的泳道。

最小字段：

- `id`：稳定 lane id。
- `role`：`app`、`render_thread`、`producer`、`buffer_queue`、`surfaceflinger`、`hwc_present`、`critical_task`、`unknown`。
- `title`：界面展示名。
- `processName` / `threadName` / `layerName`：实际 trace 标识。
- `trackHint`：前端 pin/定位 track 的建议。
- `pipelineIds`：与 detection candidate 的关联。
- `confidence`：当前 lane 的证据置信度。
- `evidenceSource`：例如 `pipeline_bundle`、`observed_slice_query`、`active_rendering_processes`。

### 3.3 Events

`observedFlow.events[]` 表示真实 trace 事件。

最小字段：

- `id`
- `stage`
- `name`
- `ts`
- `dur`
- `durMs`
- `processName`
- `threadName`
- `trackId`
- `utid`
- `evidenceSource`
- `laneId`
- `relatedFrame` / `relatedLayer` 可选
- `threadStateId` / `criticalTaskId` 可选，用于把 slice 与调度关键任务关联。

### 3.4 Critical Tasks / Wakeup

`observedFlow.criticalTasks[]` 表示官方调度关键路径和直接唤醒关系。

来源：

- `thread_state.waker_id`：用于生成 `direct_wakeup` task 和 `wakes_to` dependency。
- `sched.thread_executing_span_with_slice._critical_path_stack`：用于生成 `critical_path_segment` task 和 `critical_path_to` dependency。

约束：

- 只对已观测到的关键渲染事件做 bounded 查询，避免把全 trace 调度图拖进教学结果。
- 如果 trace 缺少 `sched_wakeup` / `thread_state` 或官方 critical path 结果为空，只输出 warning / missing signal，不伪造依赖。
- critical task lane 可以进入 pin plan，但 evidenceSource 必须明确来自 `thread_state_waker_id` 或 `official_critical_path_stack`。

### 3.5 Teaching Facts

`teaching` 是解释层，保持从 YAML/doc 读取。

约束：

- 可以解释 observed lane/event。
- 可以说明常见机制、正常范围、异常信号。
- 不允许把静态 Mermaid 或 keySlices 当作当前 trace 中已经发生的事实。
- 缺失证据必须进入 `warnings` 或 `observedFlow.completeness.missingSignals`。

### 3.6 Pin/Overlay Result

`pinPlan` 负责描述要 pin 什么、为什么 pin、预期命中哪些 lane。

`overlayPlan` 负责描述哪些真实 events 会被高亮、使用哪个 skill/query、哪些 key slices 未命中。

这两个字段都必须有状态：

- `planned` / `ready`：可以执行。
- `empty`：没有可执行项。
- `partial`：部分可执行，部分缺失。
- `failed`：执行或查询失败。

## 4. 后端重构方案

### 4.1 Route 收敛

`POST /api/agent/v1/teaching/pipeline` 保持入口兼容。

route 只负责：

- 鉴权与 request context。
- 校验 `traceId` 是否属于当前上下文。
- 校验 trace 是否已上传到后端。
- 传入 trace/package/selection/visible window context。
- 调用 `RenderingPipelineTeachingService`。
- 返回 JSON。

不再在 route 内重复拼装 detection、teaching、pin。

### 4.2 新增应用服务

新增 `RenderingPipelineTeachingService`。

职责：

- 执行 `rendering_pipeline_detection`。
- 以 `pipeline_bundle` 为唯一聚合入口读取 detection、teachingContent、pinInstructions、activeRenderingProcesses。
- 兼容旧 skill result：如果缺少 `pipeline_bundle`，只保留最小 fallback，并输出 warning。
- 生成 `observedFlow`。
- 生成 `pinPlan`、`overlayPlan`、`warnings`。
- 同时保留旧字段 `teaching`、`pinInstructions`、`activeRenderingProcesses`。

### 4.3 Observed Flow 查询

observed flow 的查询优先级：

1. selected range/frame/layer。
2. 当前 visible window。
3. packageName/backendTraceId。
4. dominant process fallback。

查询内容：

- App main thread / Choreographer / traversal / performTraversals。
- RenderThread / DrawFrame / syncFrameState / GPU command submission。
- Embedded producer：WebView、Flutter、RN、GL、TextureView、SurfaceView、camera/video/game producer。
- BufferQueue/BLAST/Transaction：queueBuffer、dequeueBuffer、setTransactionState、BufferTX 等。
- SurfaceFlinger/HWC/present：latchBuffer、commit、present fence、HWC composition。

初期实现可以复用并扩展 `pipeline_key_slices_overlay` 的 SQL 语义，输出 `lanes/events`；后续可把查询沉淀为独立 companion skill。

### 4.4 Multi-Pipeline Teaching

`primary_pipeline_id` 只作为入口，不作为最终单选结论。

当 detection candidates/features 中出现以下信号时，应生成多条 lane：

- WebView / Chrome Viz
- Flutter / Impeller / Skia
- React Native old/new architecture / RN Skia
- TextureView / SurfaceView
- OpenGL ES / Vulkan / ANGLE
- Camera / video / ImageReader / HardwareBufferRenderer
- Game engine / Unity / Unreal / Cocos

展示策略：

- 先分开展示 host HWUI 与 producer 链路。
- 再用 dependency/overlap 说明依赖关系。
- 无依赖证据时只并列展示，不强行连线。

### 4.5 RN Pipeline 对齐

RN pipeline、doc map、pipeline YAML 数量必须对齐。

需要确保：

- `RN_OLD_ARCH_HWUI`
- `RN_NEW_ARCH_HWUI`
- `RN_SKIA_RENDERER`

都有 YAML teaching、文档路径和 `PipelineDocService` 映射。检测到了 RN 时，文档服务不能返回“没有对应教学内容”。

## 5. 前端重构方案

### 5.1 请求上下文

点击“出图教学”时传入：

- `traceId`
- `packageName` 或 process hint
- visible time window
- selection context：selected slice/frame/thread/layer

没有 selection 时，前端仍要传 visible window；后端如果 fallback，要在 response 里明确 `fallbackUsed`。

### 5.2 Bundle 兼容教学视图

本次实现先走 bundle 兼容路径：不重做完整 Perfetto UI 插件组件架构，但教学结果不能再退回纯 markdown 拼接。兼容视图仍挂在聊天消息里，使用结构化 response 渲染 lanes、events、pin/overlay 状态和知识点，同时保留完整 markdown 作为复制内容。

当前兼容视图：

- 顶部展示 detection summary、lanes 和 pin 状态。
- 中部展示 actual events timeline。
- 下方展示 Mermaid、线程角色、关键 Slice、知识点。
- warnings 独立展示，不混在 summary 里。
- 普通聊天复制和教学摘要复制都继续可用。

后续最终组件化 UI 仍保留 TODO：等 Perfetto UI 插件结构整理完成后，把聊天消息内的兼容视图替换为独立结构化组件和更完整的 overlay 交互。

### 5.3 Pin/Overlay 反馈

pin/overlay 后前端必须显示：

- 已 pin 哪些。
- 哪些没有找到。
- 哪些因为采集缺失无法展示。
- overlay 命中多少真实 events。

### 5.4 Copy 能力

保留 Markdown 复制能力：

- 教学结果可复制完整 markdown。
- 结构化视图提供“复制诊断摘要”。
- 普通 assistant message 与教学结果都可复制。

## 6. TODO

- [x] Phase 0: 创建 `docs/features/rendering-pipeline-teaching-refactor/README.md`，写入本计划，并在 `docs/README.md` 的 feature 区加入口。
- [x] Phase 1: 梳理当前 contract，补一个 route/service contract test，锁定旧响应兼容字段和新 v2 字段。
- [x] Phase 2: 新增后端 teaching service，把 `agentTeachingRoutes.ts` 内聚合逻辑迁到 service，并统一走 `pipeline_bundle`。
- [x] Phase 3: 设计并实现 observed flow 查询，复用/扩展 `pipeline_key_slices_overlay`，输出真实 lanes/events，而不是只返回静态 keySlices。
- [x] Phase 4: 完成 multi-pipeline teaching：host HWUI 与 producer/embedded 链路分开生成 lanes/events，再用 dependency/overlap 合并展示。
- [x] Phase 4b: 接入 Perfetto 官方 critical path / wakeup 事实：用 `thread_state.waker_id` 和 `_critical_path_stack` 生成 `criticalTasks`、`wakes_to`、`critical_path_to`。
- [x] Phase 5a: 前端 bundle 兼容实现：不做最终组件化 UI，但在现有聊天消息内渲染 lanes、actual events、pin/overlay result 和教学知识点，并保留 markdown 复制能力。
- [ ] Phase 5b: 最终组件化 UI：等 Perfetto UI 插件结构整理完成后，把 markdown 兼容展示替换成独立结构化组件，补齐 overlay 命中交互和更完整的 UI 自动化测试。
- [x] Phase 6: 更新策略文档，让 `teaching.strategy.md` 与 UI 快捷入口使用同一 observed-flow 语义。
- [ ] Phase 7: 清理旧 contract 分裂，生成/同步 frontend types，旧字段只保留兼容层并标注 deprecated。
- [ ] Phase 8: 补完整验证：后端 unit/contract、Skill validation、策略 validation、backend build、scene trace regression、前端源码 typecheck 和 teaching compatibility unit test 已完成；最终组件化 UI 自动化测试随 Phase 5b 补齐。

## 7. Test Plan

后端：

- `teaching/pipeline` 无 trace、无权限、trace 未上传、正常 trace 均有 contract test。
- 标准 HWUI trace 返回单 host lane；WebView/Flutter/TextureView/RN/SurfaceView 返回 host + producer lanes。
- 低采集完整度 trace 返回 warnings，不伪造缺失事件。
- `pipeline_bundle` 与 route response 字段一致，不再出现 camelCase/snake_case 双合同漂移。

Skill/SQL：

- `npm --prefix backend run validate:skills`。
- `pipeline_key_slices_overlay` 覆盖 package、time range、missing slice、multi-process 场景。
- `test:scene-trace-regression` 至少确认现有 scrolling/general pipeline 不被教学重构破坏。

前端：

- 出图教学按钮能展示结构化视图、Mermaid、lanes/events、pin/overlay 状态。
- 没有 current selection 时使用 visible window 或 dominant process fallback，并明确标注 fallback。
- 复制功能保留，普通 assistant message 与教学结果都可复制。
- pin 失败或 track 未找到时不静默失败。

## 8. Assumptions

- 默认创建新 feature 文档：`docs/features/rendering-pipeline-teaching-refactor/README.md`。
- 兼容现有 `/api/agent/v1/teaching/pipeline` 入口，不另开新 endpoint，除非实现阶段发现兼容成本过高。
- 不把 LLM 作为事实来源；LLM 只能在后续可选解释层中总结确定性证据。
- 当前实现阶段以后端 v2 contract、observed flow、pin/overlay 状态、文档/策略对齐和前端 bundle 兼容展示为优先；最终组件化 UI 作为后续独立任务推进。
