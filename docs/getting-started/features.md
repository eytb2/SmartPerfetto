# 功能总览

[English](features.en.md) | [中文](features.md)

这份文档面向 SmartPerfetto 使用者，说明它大概能做什么、从哪里触发、输出结果是什么。安装和配置步骤见 [快速开始](quick-start.md) 和 [配置指南](configuration.md)。

## 1. Perfetto UI 内的 AI Assistant

SmartPerfetto 在 Perfetto UI 中内置 AI Assistant 面板。用户加载 `.pftrace` 或 `.perfetto-trace` 后，可以直接用自然语言提问，例如：

```text
分析启动性能
分析滑动卡顿
帮我看看这个 ANR
这段选区里主线程为什么卡住？
```

入口：

- 打开 `http://localhost:10000`。
- 加载 Trace。
- 打开 SmartPerfetto AI Assistant 面板。
- 选择 `fast`、`full` 或 `auto` 分析模式。
- 输入问题并发送。

效果：

- AI 会调用后端 TraceProcessor、SQL、Skill 和场景策略进行分析。
- UI 会流式展示进度、SQL/Skill 证据、表格结果和最终结论。
- 结论应能追溯到具体时间段、线程、slice、SQL 行或 Skill 结果。

## 2. 常见性能场景分析

SmartPerfetto 内置 Android 性能分析场景，适合从 trace 中快速定位问题。

| 场景 | 可以问什么 | 典型输出 |
|---|---|---|
| 启动 | `分析启动性能`、`启动慢在哪里` | 启动阶段拆解、主线程阻塞、关键 slice、耗时指标 |
| 滑动/Jank | `分析滑动卡顿`、`这次滑动 FPS 怎么样` | FPS/Jank 指标、慢帧列表、UI/RenderThread/调度原因 |
| ANR | `帮我看看这个 ANR` | 主线程等待、Binder/锁/调度线索、可疑根因 |
| 交互延迟 | `点击后为什么响应慢` | 输入到绘制链路、主线程与渲染线程延迟 |
| 内存/CPU | `看下内存压力`、`CPU 为什么这么高` | 进程/线程维度统计、调度与资源占用证据 |
| 渲染管线 | `分析这段渲染链路` | App、Framework、SurfaceFlinger、HWC/GPU 相关证据 |

效果：

- 轻量问题可以用 `fast`。
- 启动、滑动、ANR、复杂渲染根因建议用 `full` 或 `auto`。
- 对于不确定结论，SmartPerfetto 会保留 uncertainty 或要求更多证据，而不是把推测写成事实。

## 3. 选区和上下文追问

SmartPerfetto 会把 Perfetto UI 中的 area selection 或 track event selection 传给 AI Assistant。你可以先在时间线上选中一段，再问：

```text
只看我选中的这段时间，为什么 UI thread 变慢？
这个 slice 前后有没有 Binder 或调度问题？
```

入口：

- 在 Perfetto 时间线上选中时间范围或事件。
- 在 AI Assistant 中提问。

效果：

- AI 会优先围绕选区分析。
- 适合把大 trace 缩小到一次点击、一次滑动、一帧或一个可疑 slice。
- 多轮追问会复用当前 session，适合逐步收敛根因。

## 4. 证据表格、Skill 结果和可追溯结论

SmartPerfetto 的输出通常分成三类：

- SQL 结果：来自 `trace_processor_shell` 的精确查询结果。
- Skill 结果：来自内置 YAML Skill 的结构化分析，通常按 L1-L4 从概览到深层根因展开。
- Agent 结论：AI 基于 SQL、Skill、策略和 verifier 生成的解释。

效果：

- 适合把“看到一堆 timeline”变成可读的根因链路。
- 关键数值应该有来源，不应只出现在自然语言里。
- 复杂分析会尽量给出优化方向、验证方式和残留不确定性。

## 5. HTML 分析报告

AI 分析完成后，后端会生成 HTML report。

入口：

- 在 AI Assistant 中完成一次分析。
- 从 UI 返回的报告入口打开。
- 后端也提供通用报告接口 `/api/reports/:reportId`。

效果：

- 把本次分析的问题、证据、结论和建议整理成可阅读报告。
- 适合分享给团队、贴到 issue、保存为回归分析记录。

## 6. Trace 实时对比

Trace 实时对比用于在同一个 AI 对话中选择一条 reference Trace，让 AI 同时查询当前 Trace 和 reference Trace。

入口：

- 在 AI Assistant 顶部点击 `compare_arrows`。
- 选择一条 reference Trace。
- 继续提问，例如 `对比当前 trace 和参考 trace 的滑动差异`。

效果：

- AI 可以在同一次分析中访问 current/reference 两条 raw trace。
- 适合临时对比两条已加载或可访问的 Trace。
- 这个模式偏实时分析，不是跨窗口、跨用户的持久结果对比。

## 7. 多 Trace 分析结果对比

多 Trace 分析结果对比用于比较已经完成的 AI 分析结果。它不要求另一个 Perfetto UI 窗口继续打开。

入口：

- 完成至少两次 AI 分析，等 AI Assistant 顶部出现 `Ready result` 或 `Partial result`。
- 点击顶部 `fact_check` 图标打开“分析结果对比”。
- 选择一个 `基线` 和一个或多个 `候选`。
- 可选：把 private 结果 `共享` 为 workspace 可见。
- 点击 `开始对比`。

效果：

- 输出 baseline/candidate 的标准指标矩阵和 delta。
- 支持启动耗时、FPS/Jank 等可标准化指标。
- 支持 2 个或更多 snapshot。
- 输出显著变化数量，并提供 HTML comparison report。

完整说明见 [多 Trace 分析结果对比](multi-trace-result-comparison.md)。

## 8. Provider 管理和运行时切换

SmartPerfetto 支持在 UI 中管理模型 provider，也支持通过 `.env` 配置。

入口：

- AI Assistant 设置面板中的 `Providers` 页。
- `backend/.env` 或 Docker 根目录 `.env`。
- AI 输入框旁的 provider/runtime 切换入口。

效果：

- 可以接入 Anthropic、Claude/Anthropic-compatible provider、OpenAI/OpenAI-compatible provider。
- UI 中激活的 Provider Manager profile 优先于 `.env`。
- 后端 health 信息会显示当前 credential source，便于排障。

完整配置见 [配置指南](configuration.md)。

## 9. 自动化、API 和 CLI

除了 UI，SmartPerfetto 也提供后端 API、CLI 和 MCP 工具文档，适合自动化场景。

入口：

- 后端 API：[API 参考](../reference/api.md)。
- CLI：[CLI 参考](../reference/cli.md)。
- MCP 工具：[MCP 工具参考](../reference/mcp-tools.md)。

效果：

- 可以把 Trace 分析接入脚本、CI、批处理或内部平台。
- 可以复用相同的 Skill、策略、报告和 evidence-backed 输出机制。

## 10. 运行和分发方式

SmartPerfetto 支持多种运行方式：

| 方式 | 适合谁 | 说明 |
|---|---|---|
| Docker | 普通使用者、快速部署 | 使用已提交的预构建 Perfetto UI，不需要本地构建 submodule |
| 免安装包 | 不想安装 Docker 的用户 | Windows、macOS、Linux 包内带 Node runtime、后端、预构建 UI 和 trace_processor |
| 本地源码运行 | 开发者、调试者 | 使用 `./start.sh` 启动后端和预构建 UI |
| Dev 模式 | 修改 Perfetto UI 插件的人 | 使用 `./scripts/start-dev.sh` 调试 `perfetto/` submodule 前端 |

运行方式见 [快速开始](quick-start.md)，打包发布见 [免安装包打包](../reference/portable-packaging.md)。

## 功能选择建议

| 你想做什么 | 推荐入口 |
|---|---|
| 快速问一个 trace 的事实 | AI Assistant + `fast` |
| 深入分析启动、滑动、ANR | AI Assistant + `full` 或 `auto` |
| 只看某一段时间或某个 slice | Perfetto 选区 + AI Assistant |
| 生成可分享的分析结论 | HTML report |
| 当前对话中临时对比 reference Trace | `compare_arrows` Trace 实时对比 |
| 跨窗口/跨用户对比已完成结果 | `fact_check` 多 Trace 分析结果对比 |
| 接入脚本或平台 | API / CLI / MCP 工具 |
