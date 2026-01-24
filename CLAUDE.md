# SmartPerfetto Development Guide

AI-driven Perfetto analysis platform for Android performance data.

## Architecture Overview

```
Frontend (Perfetto UI @ :10000) ◄─SSE/HTTP─► Backend (Express @ :3000)
                │                                     │
                └───────── HTTP RPC (9100-9900) ──────┘
                                  │
                    trace_processor_shell (Shared)
```

**Core Concepts:**
- Frontend/backend share `trace_processor_shell` via HTTP RPC
- Agent-Driven hypothesis analysis (假设驱动分析)
- Strategy-based staged analysis (策略驱动分阶段分析)
- Domain Agents collect evidence via SQL queries
- Analysis logic in YAML Skills (`backend/skills/`)
- Results layered: L1 (overview) → L2 (list) → L3 (diagnosis) → L4 (deep)
- SSE for real-time streaming

---

## Backend Structure

### Agent System (v5.0 - Strategy + Agent-Driven)

**Core:** `backend/src/agent/core/`
| Component | Purpose |
|-----------|---------|
| agentDrivenOrchestrator.ts | 主协调器 (策略匹配 + 假设驱动多轮分析) |
| circuitBreaker.ts | 熔断器，触发用户介入 |
| modelRouter.ts | 多模型路由 (DeepSeek/OpenAI/Anthropic/GLM) |
| stateMachine.ts | 状态机 (IDLE→PLANNING→HYPOTHESIS→ROUNDS→CONCLUSION) |

**Strategies (NEW):** `backend/src/agent/strategies/`
| Component | Purpose |
|-----------|---------|
| types.ts | StagedAnalysisStrategy, FocusInterval, StageDefinition, StageTaskTemplate |
| registry.ts | StrategyRegistry - trigger 匹配策略选择 |
| scrollingStrategy.ts | 滑动分析策略 (overview → per_interval 多阶段) |
| helpers.ts | 区间提取和格式化工具函数 |

**Decision Trees:** `backend/src/agent/decision/`
| Component | Purpose |
|-----------|---------|
| decisionTreeExecutor.ts | 决策树执行引擎 |
| decisionTreeStageExecutor.ts | 决策树与 Pipeline 集成 |
| skillExecutorAdapter.ts | Skill 调用适配器 |
| types.ts | 决策节点/分支/树类型 |
| trees/scrollingDecisionTree.ts | 滑动场景决策树 |
| trees/launchDecisionTree.ts | 启动场景决策树 |

**Domain Agents:** `backend/src/agent/agents/domain/`
| Agent | Purpose |
|-------|---------|
| frameAgent.ts | 帧渲染分析 |
| cpuAgent.ts | CPU 调度与负载 |
| memoryAgent.ts | 内存分配与 GC |
| binderAgent.ts | IPC/Binder 事务 |
| additionalAgents.ts | Startup、Interaction、ANR、System |

**Planning & Evaluation:** `backend/src/agent/agents/`
- plannerAgent.ts - 意图理解、任务分解
- evaluatorAgent.ts - 结果质量评估
- iterationStrategyPlanner.ts - 迭代策略决策（是否继续下一轮）
- sceneReconstructionAgent.ts - 场景重建
- scrollingExpertAgent.ts - 滑动专家

**Agent Bases:** `backend/src/agent/agents/base/`
- baseAgent.ts - Agent 基类
- baseSubAgent.ts - SubAgent 基类

**Communication:** `backend/src/agent/communication/`
- agentMessageBus.ts - Agent 间消息总线

**Context & State:**
- `context/enhancedSessionContext.ts` - 多轮对话上下文
- `context/contextBuilder.ts` - 按角色过滤上下文
- `context/policies/` - Planner/Evaluator/Worker Policy
- `compaction/contextCompactor.ts` - Token 溢出防护
- `compaction/tokenEstimator.ts` - Token 用量估算
- `compaction/strategies/slidingWindowStrategy.ts` - 滑动窗口压缩
- `state/checkpointManager.ts` - 暂停/恢复
- `state/sessionStore.ts` - 会话持久化
- `fork/forkManager.ts` - 会话分叉
- `fork/mergeStrategies.ts` - 分叉合并策略
- `fork/sessionTree.ts` - 会话树结构

**Hooks (Middleware):** `backend/src/agent/hooks/`
| Component | Purpose |
|-----------|---------|
| hookTypes.ts | Hook 生命周期和注册类型 |
| hookRegistry.ts | Hook 注册管理 |
| hookContext.ts | Hook 执行上下文 |
| middleware/loggingMiddleware.ts | 日志中间件 |
| middleware/timingMiddleware.ts | 计时中间件 |

**Experts:** `backend/src/agent/experts/`
- launchExpert.ts, interactionExpert.ts, systemExpert.ts
- `base/baseExpert.ts` - Expert 基类
- `crossDomain/` - 跨域分析
  - baseCrossDomainExpert.ts - 跨域基类
  - hypothesisManager.ts - 假设生命周期管理
  - dialogueProtocol.ts - Agent 通信协议
  - moduleCatalog.ts - 模块目录
  - moduleExpertInvoker.ts - 模块专家调用
  - experts/performanceExpert.ts - 性能综合分析

**Tools:** `backend/src/agent/tools/`
- sqlExecutor.ts - SQL 查询执行
- frameAnalyzer.ts - 帧分析
- skillInvoker.ts - Skill 调用
- dataStats.ts - 数据统计

**Detectors:** `backend/src/agent/detectors/`
- architectureDetector.ts - 架构检测 (总控)
- baseDetector.ts - Detector 基类
- standardDetector.ts - 标准 Android
- composeDetector.ts - Jetpack Compose
- flutterDetector.ts - Flutter
- webviewDetector.ts - WebView

**Other:**
- `types/agentProtocol.ts` - Agent 通信协议类型
- `llmAdapter.ts` - LLM 适配器
- `toolRegistry.ts` - 工具注册表
- `traceRecorder.ts` - Trace 录制
- `evalSystem.ts` - 评估系统

### Key Services

| Service | Location | Purpose |
|---------|----------|---------|
| TraceProcessorService | services/traceProcessorService.ts | HTTP RPC 查询 (端口池 9100-9900) |
| SkillExecutor | services/skillEngine/skillExecutor.ts | YAML Skill 引擎 |
| SkillLoader | services/skillEngine/skillLoader.ts | Skill 加载器 |
| SkillAnalysisAdapter | services/skillEngine/skillAnalysisAdapter.ts | Skill 分析适配 |
| AnswerGenerator | services/skillEngine/answerGenerator.ts | 答案生成器 |
| SmartSummaryGenerator | services/skillEngine/smartSummaryGenerator.ts | 智能摘要 |
| HTMLReportGenerator | services/htmlReportGenerator.ts | HTML 报告生成 |
| SessionLogger | services/sessionLogger.ts | JSONL 会话日志 |
| AutoAnalysisService | services/autoAnalysisService.ts | 自动分析服务 |
| SessionPersistenceService | services/sessionPersistenceService.ts | 会话持久化 |
| ResultExportService | services/resultExportService.ts | 结果导出 |

---

## Data Flow

```
User Query → POST /api/agent/analyze → AgentDrivenOrchestrator
    │
    ├─ Phase 1: Strategy Matching
    │   └─ StrategyRegistry.match(query) → scrollingStrategy / null
    │
    ├─ [Strategy Match] Multi-Stage Pipeline:
    │   ├─ Stage 0 (overview): Global tasks → Domain Agents
    │   ├─ extractIntervals() → FocusInterval[]
    │   ├─ Stage 1 (per_interval): Per-interval tasks
    │   └─ Synthesize findings → analysis_completed
    │
    ├─ [No Strategy] Hypothesis-Driven Rounds:
    │   ├─ Round 1:
    │   │   ├─ LLM 理解意图 → 生成假设 (Hypotheses)
    │   │   ├─ 分派任务 → Domain Agents (Frame/CPU/Memory/Binder)
    │   │   ├─ Agents 执行 SQL → 收集 Evidence
    │   │   ├─ 综合 Findings (severity: critical/warning/info)
    │   │   └─ IterationStrategyPlanner → 评估置信度
    │   │
    │   ├─ Round N (if confidence < threshold):
    │   │   └─ 深入分析，补充证据
    │   │
    │   └─ Conclusion → analysis_completed SSE event
    │
    └─ Circuit Breaker: 置信度过低时触发用户介入
```

---

## Strategy System (NEW)

**Purpose:** 将常见分析场景（滑动、启动等）编码为确定性多阶段流水线，避免 LLM 不确定性。

```
Query → StrategyRegistry.match()
           ├─ scrollingStrategy.trigger("分析滑动卡顿") → ✅
           └─ (future) launchStrategy.trigger("启动慢") → ✅

Strategy Execution:
  Stage 0 (overview):
    - tasks: [{ agentId: 'frame_agent', scope: 'global', skillParams: {...} }]
    - extractIntervals: responses → FocusInterval[]
    - shouldStop: intervals.length === 0 → early exit

  Stage 1 (per_interval):
    - tasks: [{ agentId: 'frame_agent', scope: 'per_interval' }]
    - Each FocusInterval gets its own task with start_ts/end_ts
```

**Key Concepts:**
- `StagedAnalysisStrategy` — 策略定义 (trigger + stages)
- `StageDefinition` — 阶段定义 (tasks + extractIntervals + shouldStop)
- `StageTaskTemplate` — 任务模板 (agentId + scope + skillParams)
- `FocusInterval` — 焦点区间 (startTs/endTs/processName/priority)
- `skillParams` — 泛型参数传递，Strategy → Agent → Skill (e.g., `max_frames_per_session`)

---

## Skill System

**Types:** atomic, composite, iterator, parallel, conditional

**Layered Results:**
- **L1 (overview):** 聚合指标 - `display.level: overview/summary`
- **L2 (list):** 数据列表 - `display.level: list/detail` + expandableData
- **L3 (diagnosis):** 逐帧诊断 - iterator over jank frames
- **L4 (deep):** 详细分析 - `display.level: deep/frame`

**Parameter Substitution:**
```yaml
# Skill 通过 ${param|default} 接收参数
inputs:
  - name: max_frames_per_session
    type: number
    required: false
steps:
  - id: diagnose
    type: iterator
    max_items: "${max_frames_per_session|8}"  # Strategy 传参覆盖默认值
```

**Skill Example:**
```yaml
name: scrolling_analysis
type: composite
steps:
  - id: summary
    sql: "SELECT COUNT(*) as total..."
    display: { level: overview, title: "概览" }
  - id: jank_frames
    sql: "SELECT frame_id, ts, dur..."
    display:
      level: list
      columns:
        - { name: ts, type: timestamp, clickAction: navigate_timeline }
        - { name: dur, type: duration, format: duration_ms }
```

**Location:** `backend/skills/`
- `atomic/` - 单步检测 (17 skills)
- `composite/` - 组合分析 (28 skills)
- `deep/` - 深度分析 (2 skills)
- `modules/` - 模块配置 (app/framework/hardware/kernel)
- `vendors/` - 厂商适配 (pixel/samsung/xiaomi/honor/oppo/vivo/qualcomm/mtk)

---

## DataEnvelope (v2.0)

统一数据契约 - 数据自描述，前端按配置渲染。

```typescript
interface DataEnvelope<T> {
  meta: { type, version, source, skillId?, stepId? };
  data: T;  // { columns, rows, expandableData }
  display: { layer, format, title, columns?: ColumnDefinition[] };
}

interface ColumnDefinition {
  name: string;
  type: 'timestamp' | 'duration' | 'number' | 'string' | 'percentage' | 'bytes';
  format?: 'duration_ms' | 'timestamp_relative' | 'compact';
  clickAction?: 'navigate_timeline' | 'navigate_range' | 'copy';
}
```

**Type Generation:** `npm run generate:frontend-types` (auto-run by start-dev.sh)

---

## Frontend

**Plugin:** `perfetto/ui/src/plugins/com.smartperfetto.AIAssistant/`
- ai_panel.ts - 主 UI
- sql_result_table.ts - 数据表格 (schema-driven)
- ai_service.ts - 后端通信

---

## API Endpoints

**Agent (唯一主链路):**
- `POST /api/agent/analyze` - 启动分析 (Strategy 匹配 → AgentDrivenOrchestrator)
- `GET /api/agent/:sessionId/stream` - SSE 实时流
- `GET /api/agent/:sessionId/status` - 轮询状态
- `POST /api/agent/:sessionId/respond` - 响应断路器
- `POST /api/agent/scene-reconstruct` - 场景重建（独立功能）

**Logs:**
- `GET /api/agent/logs/:sessionId` - 会话日志
- `GET /api/agent/logs/:sessionId/errors` - 仅错误

**Trace:**
- `POST /api/traces/register-rpc` - 注册 RPC

---

## SSE Events (Agent-Driven)

| Event | Phase Mapping | Description |
|-------|---------------|-------------|
| progress | starting, understanding, concluding | 阶段进度 |
| hypothesis_generated | hypotheses_generated | 假设生成 |
| round_start | round_start | 新一轮开始 |
| agent_task_dispatched | tasks_dispatched | 任务批量分派 |
| agent_dialogue | task_dispatched | 单任务分派 |
| agent_response | task_completed | Agent 完成任务 |
| synthesis_complete | synthesis_complete | 综合结果 |
| strategy_decision | strategy_decision | 迭代策略决定 |
| analysis_completed | - | 分析完成 |
| error | - | 错误 |

---

## Session Management

- 路由层内存 `Map<sessionId, AnalysisSession>` 管理会话
- 每 30 分钟清理过期会话
- 支持多轮对话（复用 sessionId）
- AnalysisSession 包含: orchestrator, sseClients, result, hypotheses, agentDialogue

---

## Quick Start

```bash
./scripts/start-dev.sh  # Auto-builds trace_processor_shell
# Backend @ :3000, Frontend @ :10000
```

---

## Common Issues

| Issue | Solution |
|-------|----------|
| "AI backend not connected" | `./scripts/start-dev.sh` |
| Empty data | 检查 stepId 匹配 YAML `id:` |
| Port conflict | `pkill -f trace_processor_shell` |
| Debug | 查看 `backend/logs/sessions/*.jsonl` |

---

## Environment

```bash
# backend/.env
PORT=3000
AI_SERVICE=deepseek
DEEPSEEK_API_KEY=sk-xxx
```
