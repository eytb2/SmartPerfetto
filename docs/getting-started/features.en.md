# Feature Overview

[English](features.en.md) | [中文](features.md)

This guide is for SmartPerfetto users. It explains what the product can do, where to trigger each feature, and what output to expect. For installation and configuration, see [Quick Start](quick-start.en.md) and [Configuration Guide](configuration.en.md).

## 1. AI Assistant Inside Perfetto UI

SmartPerfetto embeds an AI Assistant panel inside Perfetto UI. After loading a `.pftrace` or `.perfetto-trace`, you can ask natural-language questions such as:

```text
Analyze startup performance
Analyze scrolling jank
Analyze this ANR
Why is the main thread blocked in my selected range?
```

Entry points:

- Open `http://localhost:10000`.
- Load a trace.
- Open the SmartPerfetto AI Assistant panel.
- Choose `fast`, `full`, or `auto`.
- Ask a question.

Output:

- The AI calls backend TraceProcessor, SQL, Skills, and scene strategies.
- The UI streams progress, SQL/Skill evidence, tables, and the final conclusion.
- Conclusions should trace back to concrete time ranges, threads, slices, SQL rows, or Skill results.

## 2. Common Performance Scenarios

SmartPerfetto includes Android performance analysis scenarios for common trace investigations.

| Scenario | Example prompt | Typical output |
|---|---|---|
| Startup | `Analyze startup performance`, `Why is startup slow?` | Startup phase breakdown, main-thread blocking, key slices, duration metrics |
| Scrolling/Jank | `Analyze scrolling jank`, `How was FPS in this scroll?` | FPS/Jank metrics, slow frames, UI/RenderThread/scheduler evidence |
| ANR | `Analyze this ANR` | Main-thread wait, Binder/lock/scheduler signals, likely root cause |
| Interaction latency | `Why did this tap respond slowly?` | Input-to-render path, main-thread and rendering-thread delay |
| Memory/CPU | `Check memory pressure`, `Why is CPU high?` | Process/thread stats, scheduling and resource evidence |
| Rendering pipeline | `Analyze this rendering path` | App, Framework, SurfaceFlinger, HWC/GPU evidence |

Output:

- Use `fast` for lightweight facts.
- Use `full` or `auto` for startup, scrolling, ANR, and complex rendering root-cause analysis.
- When evidence is incomplete, SmartPerfetto should preserve uncertainty instead of presenting guesses as facts.

## 3. Selection-Aware Follow-Up

SmartPerfetto sends Perfetto area selections and track-event selections to AI Assistant. Select a time range or event first, then ask:

```text
Only inspect my selected time range. Why did the UI thread slow down?
Is there a Binder or scheduling problem around this slice?
```

Entry points:

- Select a time range or event in the Perfetto timeline.
- Ask a question in AI Assistant.

Output:

- The AI focuses on the selected context first.
- Useful for reducing a large trace to one tap, one scroll, one frame, or one suspicious slice.
- Follow-up questions reuse the current session so you can narrow the root cause step by step.

## 4. Evidence Tables, Skill Results, And Traceable Conclusions

SmartPerfetto output usually contains three evidence types:

- SQL results from `trace_processor_shell`.
- Skill results from built-in YAML analysis pipelines, often rendered as L1-L4 layers from overview to deep root cause.
- Agent conclusions based on SQL, Skills, strategies, and verifier checks.

Output:

- Turns dense timelines into readable causal chains.
- Key numbers should have sources, not only natural-language statements.
- Complex analyses should include optimization direction, validation ideas, and remaining uncertainty.

## 5. HTML Analysis Reports

After an AI analysis completes, the backend generates an HTML report.

Entry points:

- Complete an AI analysis in AI Assistant.
- Open the report link returned by the UI.
- The backend also exposes `/api/reports/:reportId`.

Output:

- Packages the question, evidence, conclusion, and suggestions into a readable report.
- Useful for team sharing, issues, and regression records.

## 6. Live Trace Comparison

Live trace comparison selects a reference trace inside the current AI conversation, so the AI can query the current trace and reference trace together.

Entry points:

- Click `compare_arrows` in the AI Assistant header.
- Select a reference trace.
- Ask a comparison question, for example `Compare scrolling behavior between this trace and the reference trace`.

Output:

- The AI can access both current/reference raw traces in one analysis.
- Useful for temporary two-trace comparison.
- This mode is live analysis, not cross-window or cross-user persistent result comparison.

## 7. Multi-Trace Analysis Result Comparison

Multi-trace analysis result comparison compares completed AI analysis results. It does not require the other Perfetto UI window to stay open.

Entry points:

- Complete at least two AI analyses and wait for `Ready result` or `Partial result` in the AI Assistant header.
- Shortcut: type `Compare with the other result`, or specify a result by the `Result ID` shown next to the result title, for example `Compare AR-1234abcd`.
- Click the `fact_check` icon to open analysis result comparison.
- Choose one `Baseline` and one or more `Candidate` results.
- Optional: `Share` a private result to make it workspace-visible.
- Click `Start comparison`.

Output:

- Standard metric matrix and deltas between baseline/candidates.
- Standardized metrics such as startup duration and FPS/Jank when available.
- 2 or more snapshots in one comparison.
- When there is exactly one clear other candidate, the AI can start the comparison from a natural-language request; when the target is ambiguous, it asks you to choose.
- Significant change count and an HTML comparison report.

See [Multi-Trace Analysis Result Comparison](multi-trace-result-comparison.en.md) for the full workflow.

## 8. Provider Management And Runtime Switching

SmartPerfetto supports UI-managed model providers and `.env` configuration.

Entry points:

- `Providers` tab in AI Assistant settings.
- `backend/.env` or Docker root `.env`.
- Provider/runtime switcher near the AI input.

Output:

- Supports Anthropic, Claude/Anthropic-compatible providers, and OpenAI/OpenAI-compatible providers.
- The active Provider Manager profile takes priority over `.env`.
- Backend health shows the current credential source for troubleshooting.

See [Configuration Guide](configuration.en.md) for setup details.

## 9. Automation, API, And CLI

SmartPerfetto also provides backend API, CLI, and MCP tool documentation for automation.

Entry points:

- Backend API: [API Reference](../reference/api.en.md).
- CLI: [CLI Reference](../reference/cli.en.md).
- MCP tools: [MCP Tools Reference](../reference/mcp-tools.en.md).

Output:

- Integrate trace analysis into scripts, CI, batch jobs, or internal platforms.
- Reuse the same Skills, strategies, reports, and evidence-backed output flow.

## 10. Runtime And Distribution Options

SmartPerfetto supports multiple runtime paths:

| Mode | Best for | Notes |
|---|---|---|
| Docker | Users and quick deployments | Uses committed prebuilt Perfetto UI; no local submodule build required |
| Portable packages | Users who do not want Docker | Windows, macOS, and Linux packages include Node runtime, backend, prebuilt UI, and trace_processor |
| Local source run | Developers and debugging | `./start.sh` starts backend and prebuilt UI |
| Dev mode | Perfetto UI plugin development | `./scripts/start-dev.sh` watches the `perfetto/` submodule frontend |

Runtime setup is in [Quick Start](quick-start.en.md). Packaging and release details are in [Portable Packaging](../reference/portable-packaging.en.md).

## Which Feature Should I Use?

| Goal | Recommended entry |
|---|---|
| Ask a quick fact about one trace | AI Assistant + `fast` |
| Deeply analyze startup, scrolling, or ANR | AI Assistant + `full` or `auto` |
| Inspect one selected time range or slice | Perfetto selection + AI Assistant |
| Produce a shareable conclusion | HTML report |
| Temporarily compare a reference trace in this conversation | `compare_arrows` live trace comparison |
| Compare completed results across windows or users | `fact_check` multi-trace result comparison |
| Integrate with scripts or platforms | API / CLI / MCP tools |
