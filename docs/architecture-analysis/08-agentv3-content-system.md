# agentv3 内容体系：Strategy MD + Skill YAML 双轨数据流

> 对齐版本：2026-03-12
> 范围：agentv3（Claude Agent SDK）主链路下，`.strategy.md` / `.template.md` / `.skill.yaml` / `.sop.md` 四类内容文件的加载、注入与执行路径。

---

## 0. 一句话总结

在 agentv3 架构下，内容文件分为两条独立数据路径：

- **`.md` 文件 → Claude 的"大脑"**：构成 system prompt，指导 Claude **怎么思考、怎么分析**
- **`.yaml` 文件 → Claude 的"手"**：定义 MCP 工具执行能力，控制 **怎么查数据、怎么展示结果**

```
┌───────────────────────────────────────────────────────────────────┐
│                          Claude Agent SDK                         │
│                                                                   │
│  System Prompt (由 .md 构成)          MCP Tools (由 .yaml 驱动)    │
│  ┌─────────────────────────┐         ┌─────────────────────────┐  │
│  │ prompt-role.template.md │         │ invoke_skill(skillId)   │  │
│  │ arch-*.template.md      │         │   → skillRegistry.get() │  │
│  │ prompt-methodology.md   │         │   → skillExecutor.exec()│  │
│  │   └─ {{sceneStrategy}}  │         │   → SQL → trace_proc    │  │
│  │      └─ *.strategy.md   │         │   → DataEnvelope → SSE  │  │
│  │ selection-*.template.md │         │                         │  │
│  │ prompt-output-format.md │         │ list_skills             │  │
│  └─────────────────────────┘         │   → skillRegistry.all() │  │
│                                      └─────────────────────────┘  │
│  "想什么" ← 场景策略指导              "做什么" ← SQL查询+展示编排   │
└───────────────────────────────────────────────────────────────────┘
```

---

## 1. 文件分类与位置

### 1.1 Strategy 文件（`backend/strategies/*.strategy.md`）

| 文件 | 场景 | 优先级 | 作用 |
|------|------|--------|------|
| `scrolling.strategy.md` | scrolling | 3 | 滑动/卡顿分析策略 |
| `startup.strategy.md` | startup | 2 | 应用启动分析策略 |
| `anr.strategy.md` | anr | 1 | ANR/无响应分析策略 |
| `interaction.strategy.md` | interaction | 4 | 用户交互分析策略 |
| `overview.strategy.md` | overview | 5 | 场景重建策略 |
| `general.strategy.md` | general | 99 | 通用分析（无特定场景时的 fallback） |

**文件结构：** YAML frontmatter（匹配规则）+ Markdown body（分析策略）

```markdown
---
scene: scrolling
priority: 3
effort: medium
keywords:
  - 滑动
  - 卡顿
  - jank
  - fps
  - scroll
compound_patterns:
  - (可选的正则匹配模式)
---

#### 滑动/卡顿分析
**核心原则：**
1. 逐帧根因诊断...
2. 区分真实掉帧 vs 框架标记...

**Phase 1 — 概览 + 掉帧列表:**
invoke_skill("scrolling_analysis", {...})
...
```

### 1.2 Prompt 模板文件（`backend/strategies/*.template.md`）

| 文件 | 用途 | 变量占位符 |
|------|------|-----------|
| `prompt-role.template.md` | Claude 角色定义 | 无（静态） |
| `prompt-methodology.template.md` | 分析方法论 | `{{sceneStrategy}}` |
| `prompt-output-format.template.md` | 输出格式规范 | 无（静态） |
| `selection-area.template.md` | 用户选区上下文（时间范围） | `{{startNs}}`, `{{endNs}}`, `{{durationMs}}`, `{{trackCount}}`, `{{trackSummary}}` |
| `selection-slice.template.md` | 用户选区上下文（单个事件） | 事件相关变量 |
| `arch-flutter.template.md` | Flutter 架构分析指导 | 无（静态） |
| `arch-compose.template.md` | Compose 架构分析指导 | 无（静态） |
| `arch-webview.template.md` | WebView 架构分析指导 | 无（静态） |

### 1.3 Skill YAML 文件（`backend/skills/`）

| 目录 | 数量 | 类型 | 用途 |
|------|------|------|------|
| `atomic/` | 57 | 单步 SQL | 单条查询 + 显示配置 |
| `composite/` | 28 | 多步编排 | 顺序/迭代/条件/并行组合 |
| `deep/` | 2 | 深度分析 | 帧级详细诊断 |
| `pipelines/` | 25+1 | 管线检测 | 渲染管线检测 + 教学内容 |
| `modules/` | 18 | 模块配置 | app/framework/hardware/kernel |
| `vendors/` | 8 | 厂商覆盖 | pixel/samsung/xiaomi/... |
| `fragments/` | — | SQL 片段 | 可复用的 CTE |

### 1.4 SOP 文档（`backend/skills/docs/*.sop.md`）

| 文件 | 内容 |
|------|------|
| `scrolling.sop.md` | 滑动分析标准操作流程 |
| `startup.sop.md` | 启动分析标准操作流程 |
| `anr.sop.md` | ANR 分析流程 |
| `binder.sop.md`, `gc.sop.md`, `io.sop.md`, ... | 各领域分析流程 |

**当前状态：未被 agentv3 自动加载或注入。** 仅作为开发者参考文档。

---

## 2. 数据流一：`.md` → System Prompt

### 2.1 场景分类（sceneClassifier.ts）

用户查询首先经过场景分类器，分类器的匹配规则来自 `.strategy.md` 的 YAML frontmatter：

```
用户查询 "滑动卡顿分析"
    ↓
classifyScene(query)
    ├─ 加载所有 *.strategy.md 的 frontmatter
    ├─ 按 priority 升序排列（ANR=1 最优先，general=99 最低）
    ├─ 优先匹配 compound_patterns（更精确的正则）
    ├─ 其次匹配 keywords（简单字符串包含）
    └─ 无匹配 → fallback "general"
    ↓
SceneType = "scrolling"
```

### 2.2 System Prompt 组装（claudeSystemPrompt.ts）

`buildSystemPrompt()` 将多个 `.md` 文件拼装为最终 system prompt：

```
buildSystemPrompt(context: ClaudeAnalysisContext)
    │
    ├─ Section 1: 角色定义
    │   └─ loadPromptTemplate("prompt-role") → prompt-role.template.md
    │
    ├─ Section 2: 架构信息 + 架构特定指导
    │   ├─ 检测到的渲染架构（type, pipeline, threads...）
    │   └─ loadPromptTemplate("arch-" + arch.type)
    │       → e.g., arch-flutter.template.md（如果是 Flutter 应用）
    │
    ├─ Section 3: 分析方法论 + 场景策略（核心注入点）
    │   ├─ getStrategyContent("scrolling")
    │   │   → scrolling.strategy.md 的 Markdown body
    │   ├─ loadPromptTemplate("prompt-methodology")
    │   │   → prompt-methodology.template.md（含 {{sceneStrategy}} 占位符）
    │   └─ renderTemplate(template, { sceneStrategy: strategyBody })
    │       → {{sceneStrategy}} 被替换为实际策略内容
    │
    ├─ Section 4: 用户选区上下文（如果用户在 Perfetto UI 选了时间范围/事件）
    │   ├─ loadSelectionTemplate(selectionContext.kind)
    │   │   → e.g., selection-area.template.md
    │   └─ renderTemplate(template, { startNs, endNs, durationMs, trackSummary })
    │
    ├─ Section 5: 输出格式
    │   └─ loadPromptTemplate("prompt-output-format") → prompt-output-format.template.md
    │
    ├─ Section 6-N: 动态上下文（非 .md 文件来源）
    │   ├─ 对话历史 / 实体上下文
    │   ├─ 上一轮分析计划（previousPlan）
    │   ├─ 模式记忆（positive + negative patterns）
    │   ├─ SQL 纠错对（learned SQL fix pairs）
    │   └─ Sub-agent 指导
    │
    └─ Token 预算执行（MAX_PROMPT_TOKENS = 4500）
        └─ 超限时按优先级依次丢弃：知识库 → 模式记忆 → 负面记忆 → SQL 纠错 → Sub-agent 指导
```

### 2.3 加载器（strategyLoader.ts）

| 函数 | 作用 |
|------|------|
| `loadStrategies()` | 加载所有 `*.strategy.md`，解析 frontmatter + body，返回 `Map<scene, StrategyDefinition>` |
| `getStrategyContent(scene)` | 返回指定场景的 Markdown body |
| `loadPromptTemplate(name)` | 加载 `backend/strategies/<name>.template.md` |
| `loadSelectionTemplate(kind)` | 加载 `selection-<kind>.template.md`（委托给 `loadPromptTemplate`） |
| `renderTemplate(template, vars)` | 替换 `{{key}}` 占位符 |
| `invalidateStrategyCache()` | 清除缓存（DEV 模式下每次请求自动刷新） |

**关键特性：**
- DEV 模式热重载：修改 `.md` 文件后刷新浏览器即可生效，无需重启后端
- 两级缓存：strategies 和 templates 分别缓存

---

## 3. 数据流二：`.yaml` → MCP 工具执行

### 3.1 启动加载（skillLoader.ts → SkillRegistry）

```
后端启动 → ensureSkillRegistryInitialized()
    ├─ loadFragments(skills/fragments/) → 缓存可复用 SQL CTE
    ├─ loadSkillsFromDir(skills/atomic/)
    ├─ loadSkillsFromDir(skills/composite/)
    ├─ loadSkillsFromDir(skills/deep/)
    ├─ loadModuleSkillsRecursively(skills/modules/)
    └─ loadPipelineSkills(skills/pipelines/)
    ↓
    对每个 .skill.yaml:
    ├─ fs.readFileSync() → yaml.load()
    ├─ normalizeSkillDefinition() → SkillDefinition
    ├─ validateSkillDisplayConfig() → 校验列定义
    └─ skillRegistry.set(skill.name, skill)
    ↓
skillRegistry = Map<skillName, SkillDefinition>
```

### 3.2 Claude 发现 Skill（list_skills MCP 工具）

Claude 通过 `list_skills` MCP 工具查看可用技能：

```typescript
// claudeMcpServer.ts
list_skills({ category?: string })
  → skillRegistry.getAllSkills()
  → 过滤并返回: { id, displayName, description, type, keywords }
```

### 3.3 Claude 调用 Skill（invoke_skill MCP 工具）

```
Claude 调用: invoke_skill("scrolling_analysis", { package: "com.app" })
    ↓
claudeMcpServer.ts — invoke_skill 处理:
    ├─ requirePlan() — 必须先 submit_plan（P0 强制）
    ├─ 参数标准化 (process_name ↔ package 双向映射)
    ├─ 发射 SSE progress 事件
    ↓
skillExecutor.execute("scrolling_analysis", traceId, params)
    ├─ skillRegistry.get("scrolling_analysis") → SkillDefinition
    ├─ validateSkillInputs(params) → 参数校验 + 类型转换
    ├─ resolveAvailableModules() → 检查 prerequisite 表/视图
    ├─ 按 skill.type 执行:
    │   ├─ atomic: substituteVariables(sql) → traceProcessor.query(sql) → 单步结果
    │   ├─ composite: 遍历 steps → 每步执行 → save_as 变量传递 → 多步结果
    │   ├─ iterator: source 遍历 → 调用子 skill → 循环结果
    │   └─ conditional/parallel: 条件/并行执行
    ├─ 生成 DisplayResult[]（L1-L4 分层）
    └─ 返回 SkillExecutionResult
    ↓
回到 claudeMcpServer.ts:
    ├─ emitSkillDataEnvelopes(displayResults) → SSE data 事件 → 前端渲染表格
    ├─ artifactStore.store(results) → 存入 ArtifactStore（节省 token）
    └─ 返回 artifact 引用给 Claude（而非全量数据）
```

### 3.4 YAML Skill 结构

```yaml
name: scrolling_analysis
version: "2.0"
type: composite

meta:
  display_name: "滑动性能分析"
  description: "..."
  tags: [scrolling, jank, fps]

triggers:
  keywords:
    zh: [滑动, 卡顿, 帧率]
    en: [scroll, jank, fps]

prerequisites:
  required_tables:
    - actual_frame_timeline_slice

inputs:
  - name: package
    type: string
    required: true
  - name: max_frames_per_session
    type: number
    default: 8

steps:
  - id: frame_overview
    type: atomic
    display:
      level: summary
      layer: overview
      title: "帧率概览"
      columns:
        - { name: ts, type: timestamp, clickAction: navigate_timeline }
        - { name: dur_ms, type: duration, format: duration_ms }
    sql: |
      SELECT ts, dur / 1e6 as dur_ms, jank_type
      FROM actual_frame_timeline_slice
      WHERE process_name GLOB '${package}*'
    save_as: frame_data

  - id: jank_detail
    type: iterator
    source: frame_data                    # 引用上一步的 save_as
    max_items: "${max_frames_per_session|8}"  # 支持 ${param|default} 语法
    item_skill: jank_frame_detail
    params:
      frame_id: "${item.frame_id}"
```

### 3.5 参数替换机制（substituteVariables）

```
YAML SQL 中的 ${variable} → 替换为运行时参数

规则:
├─ ${process_name}     → context.params.process_name（直接引用）
├─ ${start_ts|0}       → context.params.start_ts，缺失时用默认值 0
├─ ${item.frame_id}    → iterator 当前行的 frame_id 字段
├─ SQL 字符串内的 ${x}  → 自动转义单引号（防 SQL 注入）
└─ 未解析的变量        → 字符串上下文返回空串，其他返回 NULL
```

### 3.6 结果分层与展示

| 层级 | YAML `display.level` | 用途 | 前端展示 |
|------|---------------------|------|---------|
| L1 | `overview` / `summary` | 聚合指标（FPS、卡顿率） | 概览卡片 |
| L2 | `list` / `detail` | 数据列表（会话、卡顿帧） | 可展开表格 |
| L3 | iterator 输出 | 逐帧诊断 | 展开详情 |
| L4 | `deep` / `frame` | 详细分析 | 嵌套详情 |

结果通过 `DataEnvelope` 封装为自描述数据，前端按 `ColumnDefinition` 配置渲染：

```typescript
interface DataEnvelope<T> {
  meta: { type, version, source, skillId? };
  data: T;  // { columns, rows, expandableData }
  display: {
    layer: 'overview' | 'list' | 'session' | 'deep';
    title: string;
    columns?: ColumnDefinition[];  // 列类型、格式、点击行为
  };
}
```

---

## 4. 完整数据流图

```
用户查询 "分析滑动卡顿" ──────────────────────────────────────────────────
    │
    ▼
POST /api/agent/v1/analyze → AgentAnalyzeSessionService
    │
    ├─ isClaudeCodeEnabled() → true (默认 agentv3)
    │
    ├─ 数据流一：.md → System Prompt ─────────────────────────────────────
    │   ├─ classifyScene("分析滑动卡顿")
    │   │   ├─ 读取 scrolling.strategy.md frontmatter → keywords: [滑动, 卡顿...]
    │   │   └─ 匹配成功 → SceneType = "scrolling"
    │   │
    │   ├─ detectArchitecture() → { type: "flutter", ... }
    │   │
    │   └─ buildSystemPrompt()
    │       ├─ prompt-role.template.md        → "你是 Android 性能分析专家"
    │       ├─ arch-flutter.template.md       → "Flutter 使用 Skia/Impeller..."
    │       ├─ prompt-methodology.template.md → {{sceneStrategy}} 占位
    │       │   └─ scrolling.strategy.md body → "Phase 1: 概览+掉帧列表..."
    │       ├─ selection-area.template.md     → (如果有选区)
    │       └─ prompt-output-format.template.md → 输出格式
    │       → 最终 System Prompt (2000-4500 tokens)
    │
    ├─ 数据流二：.yaml → MCP 工具 ────────────────────────────────────────
    │   └─ 创建 MCP Server (15 tools) → 包含 invoke_skill, list_skills, ...
    │
    └─ sdkQuery({ systemPrompt, mcpServers, model, ... })
        │
        ▼
    Claude Agent SDK 自主决策循环:
        │
        ├─ submit_plan("1. 概览帧率 2. 定位卡顿帧 3. 逐帧根因")
        │
        ├─ invoke_skill("scrolling_analysis", { package: "com.app" })
        │   └─ skillExecutor → YAML steps → SQL → trace_processor
        │   └─ → DataEnvelope → SSE → 前端表格
        │   └─ → ArtifactStore → 返回摘要给 Claude
        │
        ├─ execute_sql("SELECT ... FROM slices WHERE ...")
        │   └─ 直接 SQL → trace_processor → 返回结果
        │
        ├─ submit_hypothesis("主线程 Bindercall 阻塞导致掉帧")
        ├─ invoke_skill("binder_in_range", { start_ts, end_ts })
        ├─ resolve_hypothesis("confirmed", evidence: "...")
        │
        └─ 生成最终结论 → analysis_completed → SSE
```

---

## 5. 修改与扩展指南

### 5.1 新增场景策略

1. 创建 `backend/strategies/<scene>.strategy.md`
2. 填写 YAML frontmatter：`scene`, `priority`, `keywords`, `compound_patterns`
3. 编写 Markdown body（分析策略指导）
4. **无需修改任何 TypeScript 代码** — `sceneClassifier.ts` 自动发现

### 5.2 新增架构指导

1. 创建 `backend/strategies/arch-<type>.template.md`
2. 编写纯 Markdown（无需变量）
3. 确保 `detectArchitecture()` 能返回该 type

### 5.3 新增选区模板

1. 创建 `backend/strategies/selection-<kind>.template.md`
2. 使用 `{{variable}}` 占位符
3. 在 `buildSelectionContextSection()` 中传入对应变量

### 5.4 新增 Skill

1. 在对应目录创建 `<name>.skill.yaml`
2. 定义 meta、inputs、steps、display
3. **无需修改任何 TypeScript 代码** — `skillRegistry` 启动时自动加载
4. Claude 通过 `list_skills` 自动发现新 Skill

### 5.5 修改后生效方式

| 文件类型 | 修改后生效方式 | 需要重启？ |
|---------|-------------|----------|
| `*.strategy.md` | 刷新浏览器（DEV 模式自动刷新缓存） | 否 |
| `*.template.md` | 刷新浏览器 | 否 |
| `*.skill.yaml` | 刷新浏览器（但 skillRegistry 需要注意是否有缓存） | 否 |
| `*.sop.md` | N/A（当前未被自动使用） | N/A |

---

## 6. SOP 文档的当前状态与未来方向

`backend/skills/docs/*.sop.md` 包含详细的领域分析流程（Standard Operating Procedure），但**当前未被 agentv3 自动加载或注入系统提示词**。

**潜在利用方式：**
- 作为新的 MCP 工具 `lookup_sop` 暴露给 Claude，按需查阅分析流程
- 注入 system prompt 的特定 section（按场景过滤，控制 token 预算）
- 作为 `.strategy.md` 的补充 — strategy 给方向，SOP 给具体操作步骤

---

## 7. 与 agentv2 的对比

| 维度 | agentv2（legacy） | agentv3（当前） |
|------|------------------|----------------|
| Strategy 用途 | 确定性流水线执行器（StrategyExecutor） | System prompt 指导（Claude 自主决策） |
| Skill 调用方 | StrategyExecutor / HypothesisExecutor / DirectSkillExecutor | Claude 通过 `invoke_skill` MCP 工具自主调用 |
| 场景匹配 | `StrategyRegistry.matchEnhanced()`（keyword + LLM） | `sceneClassifier.ts`（keyword-only，<1ms） |
| 决策树 | `DecisionTreeExecutor` 自动遍历 | 不使用（由 Claude 自主推理替代） |
| 执行控制 | 代码强制的 stage 流水线 | Claude 自主规划 + `submit_plan` MCP 工具 |
| .strategy.md | 不使用（策略硬编码在 TS 中） | 核心内容来源（注入 system prompt） |
| .sop.md | 不使用 | 不使用（待开发） |
