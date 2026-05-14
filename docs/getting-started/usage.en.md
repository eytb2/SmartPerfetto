# Basic Usage

[English](usage.en.md) | [中文](usage.md)

For the full feature map, entry points, and expected outputs, see [Feature Overview](features.en.md).

## Recommended Trace Content

SmartPerfetto works best with Android 12+ traces, especially traces that include FrameTimeline data. Common atrace categories:

| Scene | Minimum categories | Useful extras |
|---|---|---|
| Scrolling | `gfx`, `view`, `input`, `sched` | `binder_driver`, `freq`, `disk` |
| Startup | `am`, `dalvik`, `wm`, `sched` | `binder_driver`, `freq`, `disk` |
| ANR | `am`, `wm`, `sched`, `binder_driver` | `dalvik`, `disk` |
| GPU / rendering | `gfx`, `view`, `sched` | `freq`, `gpu`, `binder_driver` |

## UI Analysis Flow

1. Open `http://localhost:10000`.
2. Load a `.pftrace` or `.perfetto-trace` file.
3. Open the SmartPerfetto AI Assistant panel.
4. Choose an analysis mode: fast, full, or auto.
5. Ask a natural-language question.
6. Wait for SSE streaming output, table evidence, and the final conclusion.

## Common Prompt Templates

```text
Analyze scrolling jank
Analyze startup performance
Analyze this ANR
What is the app package name and main process in this trace?
Why is the main thread blocked in my selected range?
Compare scrolling behavior between this trace and the reference trace
Compare with the other result
Compare AR-1234abcd
```

## Multi-Trace Analysis Result Comparison

After AI analysis has completed on two or more traces, you can type `Compare with the other result` in the AI input. When the current window has a latest analysis result and there is exactly one clear other candidate in the same workspace, SmartPerfetto uses the current result as the baseline and starts the comparison automatically.

Each completed AI analysis shows a `Result ID` next to the result title, such as `AR-1234abcd`. If more than one candidate exists, or you want to specify the target, say `Compare AR-1234abcd`. You can also say `Compare AR-11111111 and AR-22222222`; when multiple IDs are present, the first ID is the baseline and the later IDs are candidates.

You can also use the AI Assistant toolbar's `fact_check` entry to open analysis result comparison. Select one `Baseline` and one or more `Candidate` results; SmartPerfetto returns standard metric deltas, significant-change summary, and an HTML comparison report.

This compares completed analysis results and does not require the other Perfetto UI window to stay open. See [Multi-Trace Analysis Result Comparison](multi-trace-result-comparison.en.md) for the full workflow.

## Analysis Mode Selection

| Mode | Good for | Avoid for |
|---|---|---|
| Fast | Package name, process name, trace overview, simple facts | Heavy analysis such as startup or scrolling jank |
| Full | Startup, scrolling, ANR, complex rendering root cause | A single simple fact query |
| Auto | Default daily use | Cases with strict cost or depth requirements |

Fast mode defaults to 10 turns. Heavy Skills can still return large JSON and exhaust turns, so complex performance investigations should use full mode.

## Selection and Follow-Up

The frontend sends area selections or track-event selections to the backend as `selectionContext`. Good prompts include:

```text
Only inspect my selected time range. Why did the UI thread slow down?
Is there a Binder or scheduling problem around this slice?
```

Follow-up questions reuse the current session. Switching between fast, full, and auto starts a new SDK session so lightweight and full contexts do not mix.

## Reading Output

SmartPerfetto answers usually contain three evidence types:

- SQL results directly from `trace_processor_shell`.
- Skill results from YAML analysis pipelines under `backend/skills/`, rendered in L1-L4 layers.
- Agent conclusions based on SQL, Skills, strategies, and verifier output.

The conclusion should trace back to tables, time ranges, threads, slices, or Skill results. Suggestions that are not supported by trace data should not be treated as confirmed findings.

## Generated Reports

After agent analysis completes, the backend generates an HTML report. The UI reads the report through `/api/agent/v1/:sessionId/report`; the general report endpoint is `/api/reports/:reportId`.
