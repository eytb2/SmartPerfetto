# SmartPerfetto

AI-driven Android performance analysis platform built on [Perfetto](https://perfetto.dev/).

SmartPerfetto combines Perfetto's trace visualization with an intelligent agent system that automatically analyzes performance traces, identifies root causes of jank/ANR/startup issues, and provides actionable optimization suggestions.

## Features

- **Intelligent Analysis** — Ask questions in natural language ("分析滑动卡顿", "why is startup slow?") and get structured, evidence-backed answers
- **Multi-Agent Architecture** — Domain-specialized agents (Frame, CPU, Memory, Binder) collaborate to collect and synthesize evidence
- **Strategy-Driven Pipelines** — Common scenarios (scrolling, startup) execute deterministic multi-stage analysis without LLM uncertainty
- **Layered Results** — Analysis results from high-level overview (L1) down to per-frame root cause (L4)
- **YAML Skill System** — 65+ analysis skills across atomic, composite, and deep categories; vendor-specific overrides for Pixel/Samsung/Xiaomi/etc.
- **Real-time Streaming** — SSE-based progress updates as analysis progresses through stages
- **Perfetto Integration** — Shared `trace_processor_shell` via HTTP RPC; timeline navigation from analysis results

## Quick Start

```bash
# Configure AI backend
cp backend/.env.example backend/.env
# Edit backend/.env with your API key (see "Environment" section below)

# One command to start everything (builds trace_processor_shell automatically)
./scripts/start-dev.sh
```

Access:
- **Perfetto UI**: http://localhost:10000
- **Backend API**: http://localhost:3000

### Usage

1. Open http://localhost:10000 in your browser
2. Load a Perfetto trace file
3. Open the AI Assistant panel
4. Ask a question, e.g.:
   - "分析滑动卡顿" (Analyze scroll jank)
   - "启动为什么慢？" (Why is startup slow?)
   - "CPU 调度有没有问题？" (Any CPU scheduling issues?)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (Perfetto UI @ :10000)               │
│         Plugin: com.smartperfetto.AIAssistant                    │
│         - AI Panel (ask questions, view results)                 │
│         - Timeline integration (click-to-navigate)              │
└───────────────────────────┬─────────────────────────────────────┘
                            │ SSE / HTTP
┌───────────────────────────▼─────────────────────────────────────┐
│                    Backend (Express @ :3000)                     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              AgentDrivenOrchestrator                       │   │
│  │                                                            │   │
│  │  Query → StrategyRegistry.match()                          │   │
│  │           ├─ Match: Multi-Stage Pipeline (deterministic)   │   │
│  │           └─ No Match: Hypothesis-Driven Rounds (LLM)     │   │
│  └─────────────┬────────────────────────────────────────────┘   │
│                │                                                  │
│  ┌─────────────▼────────────────────────────────────────────┐   │
│  │           Domain Agents                                    │   │
│  │   Frame │ CPU │ Memory │ Binder │ Startup │ System        │   │
│  └─────────────┬────────────────────────────────────────────┘   │
│                │                                                  │
│  ┌─────────────▼────────────────────────────────────────────┐   │
│  │           Skill Engine (YAML Skills)                       │   │
│  │   atomic/ │ composite/ │ deep/ │ modules/ │ vendors/      │   │
│  └─────────────┬────────────────────────────────────────────┘   │
│                │ SQL                                              │
│  ┌─────────────▼────────────────────────────────────────────┐   │
│  │        trace_processor_shell (HTTP RPC, port pool 9100-9900) │ │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Purpose |
|-----------|---------|
| **AgentDrivenOrchestrator** | Main coordinator: strategy matching + hypothesis-driven multi-round analysis |
| **StrategyRegistry** | Matches queries to deterministic analysis strategies (scrolling, launch, etc.) |
| **Domain Agents** | Specialized agents for Frame/CPU/Memory/Binder/Startup/System analysis |
| **Skill Engine** | Executes YAML-defined analysis skills with SQL queries and display config |
| **CircuitBreaker** | Protection against low-confidence loops, requests user intervention |
| **ModelRouter** | Multi-model support (DeepSeek/OpenAI/Anthropic/GLM) with fallback chains |

## Directory Structure

```
SmartPerfetto/
├── backend/
│   ├── src/
│   │   ├── agent/              # AI Agent system
│   │   │   ├── core/           # Orchestrator, circuit breaker, model router
│   │   │   ├── strategies/     # Staged analysis strategies
│   │   │   ├── decision/       # Decision tree execution
│   │   │   ├── agents/         # Domain agents + planner/evaluator
│   │   │   │   ├── base/       # Agent base classes
│   │   │   │   └── domain/     # Frame, CPU, Memory, Binder agents
│   │   │   ├── experts/        # Cross-domain expert analysis
│   │   │   ├── tools/          # SQL executor, skill invoker, etc.
│   │   │   ├── detectors/      # Architecture detection (Compose/Flutter/WebView)
│   │   │   ├── context/        # Session context & policies
│   │   │   ├── compaction/     # Token overflow protection
│   │   │   ├── hooks/          # Middleware (logging, timing)
│   │   │   ├── communication/  # Agent message bus
│   │   │   ├── state/          # Checkpoints, session store
│   │   │   └── fork/           # Session forking
│   │   ├── services/           # Core services
│   │   │   └── skillEngine/    # YAML skill executor & loader
│   │   └── routes/             # API endpoints
│   ├── skills/                 # Analysis skills (YAML)
│   │   ├── atomic/             # Single-step detection (17 skills)
│   │   ├── composite/          # Multi-step analysis (28 skills)
│   │   ├── deep/               # Deep analysis (2 skills)
│   │   ├── modules/            # Module configs (app/framework/hardware/kernel)
│   │   └── vendors/            # Vendor overrides (pixel/samsung/xiaomi/...)
│   ├── data/                   # Session storage (SQLite)
│   └── logs/sessions/          # Session logs (JSONL)
├── perfetto/                   # Perfetto UI (submodule)
│   └── ui/src/plugins/com.smartperfetto.AIAssistant/
└── scripts/                    # Dev scripts
```

## API Endpoints

### Analysis

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/analyze` | Start analysis (Strategy match → Agent orchestration) |
| GET | `/api/agent/:id/stream` | SSE real-time updates |
| GET | `/api/agent/:id/status` | Get analysis status |
| POST | `/api/agent/:id/respond` | Respond to circuit breaker |
| POST | `/api/agent/scene-reconstruct` | Scene reconstruction |

### Logging

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent/logs/:sessionId` | Get session logs |
| GET | `/api/agent/logs/:sessionId/errors` | Get only errors |

### Trace

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/traces/register-rpc` | Register RPC port |

## Skills (YAML)

Analysis logic is defined in YAML skills with SQL queries and display configuration:

```yaml
name: scrolling_analysis
type: composite
inputs:
  - name: package
    type: string
    required: false
  - name: max_frames_per_session
    type: number
    required: false

steps:
  - id: performance_summary
    sql: "SELECT COUNT(*) as total_frames, ..."
    display:
      level: summary
      title: "滑动性能概览"
      columns:
        - { name: total_frames, type: number }
        - { name: jank_rate, type: percentage, format: percentage }

  - id: diagnose_jank_frames
    type: iterator
    source: app_jank_frames
    max_items: "${max_frames_per_session|8}"
    item_skill: janky_frame_analysis
```

## Environment

```bash
# backend/.env
PORT=3000
AI_SERVICE=deepseek          # deepseek | openai | anthropic | glm
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_MODEL=deepseek-chat
```

## Debugging

```bash
# View session logs
curl http://localhost:3000/api/agent/logs/{sessionId}

# View only errors
curl http://localhost:3000/api/agent/logs/{sessionId}/errors
```

Logs are stored in `backend/logs/sessions/*.jsonl`.

### Common Issues

| Issue | Solution |
|-------|----------|
| "AI backend not connected" | Run `./scripts/start-dev.sh` |
| Empty analysis data | Verify trace has FrameTimeline data (Android 12+) |
| Port conflict on 9100-9900 | `pkill -f trace_processor_shell` |
| Debug agent behavior | Check `backend/logs/sessions/*.jsonl` |

## Perfetto Submodule

```bash
# First clone
git submodule update --init --recursive

# Sync updates
cd perfetto && git checkout smartperfetto && git pull fork smartperfetto

# Push both repos
./scripts/push-all.sh
```
