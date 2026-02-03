# SmartPerfetto：AI Prompt 全面 Review（Android 性能优化专家视角）

日期：2026-02-01  
范围：`backend/src/**`（Agent/SkillEngine/AIService）、`backend/skills/**`（ai_summary）、`perfetto/ui/src/plugins/com.smartperfetto.AIAssistant/**`

## 总结（结论先行）

1) **当前 Prompt 体系的最大风险不是“写得不够像专家”，而是“输入证据不完整 + 输出契约不确定”，会直接导致结论漂移与不可复现。**  
2) **P0 级缺口集中在：JSON 输出未强约束、ai_summary 未注入 inputs、时间范围解析对 0 不兼容。**这些会让“链路上游/下游”都无法稳定协同。  
3) **建议用“Prompt Contract（输入/输出契约）+ 结构化输出 + 校验/重试”作为统一基座**，再谈更高级的推理与专家风格。

## 已落地的 P0 修复（本次直接修）

### P0-1：`ai_summary/ai_decision` 未使用 `inputs` → AI 总结缺少事实依据（已修复）

- 结论：**Skill YAML 里大量 `inputs: [...]` 只是“声明”，但执行时没有把对应数据注入 Prompt，导致 AI 总结无法“只基于实际数据”。**
- 证据：
  - `backend/src/services/skillEngine/skillExecutor.ts:2025`（`executeAIDecisionStep`）
  - `backend/src/services/skillEngine/skillExecutor.ts:2075`（`executeAISummaryStep`）
  - 典型 YAML：`backend/skills/composite/cpu_analysis.skill.yaml:553`（prompt 中出现 `target_process` 等占位但无实际数据）
- 修复：在 ai_summary/ai_decision 执行时**自动附加 `[INPUT_DATA_JSON]`**（采样+列信息+计数，避免 prompt 膨胀），并强化“只基于输入数据，不可编造”。  

### P0-2：ModelRouter 对 JSON 输出未做确定性参数与 JSON-mode 兜底（已修复）

- 结论：**大量 Agent Prompt 明确要求 JSON，但调用时默认 `temperature=0.3` 且不强制 JSON-only，解析端只能“猜 JSON 块”，不确定性高。**
- 证据：
  - `backend/src/agent/agents/base/baseAgent.ts:373`（understand/plan/reflect 解析 JSON）
  - `backend/src/agent/agents/base/baseSubAgent.ts:425`（Think prompt 要求 JSON）
  - `backend/src/agent/core/modelRouter.ts:294`（旧实现不区分 JSON/non-JSON 调用）
- 修复：ModelRouter 在 `callModel` 内部根据 Prompt 内容自动检测 JSON 需求，**JSON 场景强制 `temperature=0` 并追加 JSON-only 指令**；OpenAI provider 同时启用 `response_format: json_object`（如可用）。  
  - 代码：`backend/src/agent/core/modelRouter.ts:294`、`backend/src/agent/core/modelRouter.ts:642`

### P0-3：任务图 time_range 解析对 `0` 不兼容（已修复）

- 结论：`parseTimeRange` 使用了 `start && end` 的真值判断，**当模型输出 `0`（示例中就给了 0）会被误判为无效**，导致时间范围丢失。
- 证据：`backend/src/agent/core/taskGraphPlanner.ts:32`
- 修复：改为数值/字符串的“有效性判断”，允许 `0`。  
  - 代码：`backend/src/agent/core/taskGraphPlanner.ts:32`

### P0-4：SubAgent nextActions 的参数协议不稳定（会静默丢参）（已修复）

- 结论：SubAgent 的 `nextActions` 早期设计为字符串：`"toolName:{params}"`，并用 `action.split(':')` 解析。**由于 JSON 本身包含大量 `:`，会被错误拆分导致参数被截断，最终静默降级为 `{}`，工具“看似执行了但实际没带参数”，结果不可复现。**
- 证据：
  - `backend/src/agent/agents/base/baseSubAgent.ts:281`（SubAgent.act：action→tool/params 的解析与执行链路）
- 修复：
  1) `nextActions` 支持结构化格式：`{ "toolName": "...", "params": { ... } }`，避免“字符串内嵌 JSON”。  
  2) 仍兼容旧字符串格式，但解析改为“仅按第一个冒号分隔”，并用 `parseLlmJson` 做提取/解析。  
  3) **严格模式**：params 解析失败会返回 `ToolResult.success=false` 并落 hook/post 事件，不再静默使用 `{}`。  
  - 代码：`backend/src/agent/agents/base/baseSubAgent.ts:44`、`backend/src/agent/agents/base/baseSubAgent.ts:281`

## 已落地的 P2 修复（隐私 + 可回放）

### P2-1：全链路 LLM 输入统一脱敏（已修复）

- 结论：未脱敏的 `context/inputs` 可能包含路径、token、邮箱、设备标识等，存在上送 LLM 与落日志泄露风险。
- 修复：在 **ModelRouter / SkillEngine / AIService / TraceAnalysisSkill** 的“最终上送点”统一做脱敏处理（规则化替换，保持确定性）。
  - 代码：`backend/src/utils/llmPrivacy.ts:1`
  - 代码：`backend/src/agent/core/modelRouter.ts:295`
  - 代码：`backend/src/services/skillEngine/skillExecutor.ts:2025`
  - 代码：`backend/src/services/aiService.ts:61`
  - 代码：`backend/src/services/advancedAIService.ts:1`
  - 代码：`backend/src/services/traceAnalysisSkill.ts:312`

### P2-2：Prompt/Contract 版本 + input_hash 落入 session log（已修复）

- 结论：没有 `prompt_version/contract_version/input_hash` 的情况下，很难做回放、回归对比与离线复盘。
- 修复：ModelRouter 为每次 LLM 调用输出 **privacy-safe telemetry**（promptHash/responseHash、jsonMode、temperature、promptVersion/contractVersion 等），并由 `agentRoutes` 写入 session log（不记录原始 prompt/response）。
  - 代码：`backend/src/agent/core/modelRouter.ts:294`
  - 代码：`backend/src/routes/agentRoutes.ts:1576`

## 已落地的 P1 修复（继续推进）

### P1-1：同一“SQL 生成”链路存在相互矛盾的输出要求（已修复）

- 结论：PromptTemplate 里同时出现“只返回 SQL”与“SQL+解释”的要求，**会把模型推向不稳定输出**，也会让解析端难做。
- 证据：
  - `backend/src/config/prompts.ts:26`（withSchema: “Return ONLY the SQL query”）
  - `backend/src/services/promptTemplateService.ts:69`（又要求 code block + explanation）
- 修复：统一契约为“**当需要执行 SQL 时，只输出一个 ```sql ...``` code block，不要解释**”，避免解析端/状态机误判。
  - 代码：`backend/src/config/prompts.ts:10`、`backend/src/services/promptTemplateService.ts:69`

### P1-2：`AIService.generatePerfettoSQL` 依赖脆弱的文本分隔符解析（已修复）

- 结论：使用 `--- SQL ---` / `--- EXPLANATION ---` 这种纯文本协议 + regex 解析，**一旦模型多输出/少换行就会解析失败**，影响确定性与可复现性。
- 证据：`backend/src/services/aiService.ts:197`（`generatePerfettoSQL` 入口）
- 修复：改为 **JSON-only 输出契约 + 一次修复重试**（OpenAI 启用 `response_format: json_object`），并在落库前做 SQL 校验/纠错兜底。
  - 代码：`backend/src/services/aiService.ts:197`

### P1-3：Trace SQL loop 的 SQL 提取规则过严，容易“误判为无 SQL”（已修复）

- 结论：`extractSQL` 只匹配 ` ```sql\n...\n``` `，对大小写/空格/末尾换行不兼容，**会导致模型其实给了 SQL 但系统走到“final answer”分支**。
- 证据：`backend/src/services/traceAnalysisSkill.ts:400`
- 修复：放宽匹配为 ` /```sql\\s*([\\s\\S]*?)```/i `，降低“误判无 SQL”的概率。
  - 代码：`backend/src/services/traceAnalysisSkill.ts:400`

### P1-4：跨 Provider 的“System Prompt 注入方式”不一致（已修复一处关键链路）

- 结论：不同 provider 的调用方式不一致（system vs user 拼接），会造成模型行为漂移，降低可控性。
- 证据：`backend/src/services/aiService.ts:113`（`callClaude`）
- 修复：`AIService.callClaude` 改为使用 Anthropic Messages API 原生 `system` 字段，避免把 system prompt 降权为 user 文本拼接。
  - 代码：`backend/src/services/aiService.ts:113`

### P1-5：UI 侧 slice 分析 Prompt 输入过弱、输出无固定结构（已修复）

- 结论：UI 内置的 slice 分析只提供了少量字段（缺少 thread/process/track 上下文），且输出结构不固定，容易出现“像专家但不可复现/不可对比”的回答。
- 证据：`perfetto/ui/src/plugins/com.smartperfetto.AIAssistant/ai_panel.ts:2054`
- 修复：补充 thread/process/track 关键信息（LEFT JOIN），并要求固定 markdown 结构 + 明确“只基于输入，不可编造”。
  - 代码：`perfetto/ui/src/plugins/com.smartperfetto.AIAssistant/ai_panel.ts:1992`

## Android 性能分析“专家视角”下的 Prompt 质量建议（面向确定性）

1) **必须显式声明时间单位与参考基准**：ns/ms、相对 traceStart、绝对 ts；并要求输出时携带单位。  
2) **必须要求“证据引用”**：每条关键结论要能回指到具体指标/表/字段（例如：`main_thread_states.Runnable%`、`android_startup_opinionated_breakdown`）。  
3) **必须要求“缺口清单”**：当关键表/模块缺失时，输出应固定包含 `missing_data` 与 `how_to_collect`（启用哪些 Perfetto module、需要什么操作）。  
4) **建议把阈值作为可配置输入而非硬编码在 prompt**：例如 16.67ms、TTID/TTFD、jank rate 分级；避免不同设备/刷新率下误判。

## 建议的 Prompt Contract（落地路线）

1) **把“结构化输出”作为默认**：Agent 内部（understand/plan/eval）统一 JSON schema；摘要类（ai_summary）可输出 markdown，但必须包含固定小节。  
2) **统一 Prompt 注入与裁剪策略**：所有“表格/列表”进入 LLM 前先做采样、排序、统计，严格限制 token。  
3) **解析失败 = 自动修复重试**：任何 JSON 解析失败都触发一次修复 prompt（低温度、只输出 JSON）。  
4) **统一版本化**：prompt 版本号 + data contract 版本号（便于回放与回归）。
