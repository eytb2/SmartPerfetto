# SmartPerfetto CLI Assistant Design

**Date**: 2025-12-26
**Status**: Design Approved

## Overview

An AI-powered command-line assistant embedded in Perfetto UI as a sidebar panel. Similar to how Claude Code complements IDEs, SmartPerfetto complements Perfetto UI — not replacing it, but enhancing it with AI capabilities.

### Core Insight

- **Perfetto UI ≈ IDE** (irreplaceable visualization)
- **SmartPerfetto ≈ Claude Code** (AI assistant for understanding and navigation)

### User Workflow

1. Open Trace file in Perfetto UI (local mode)
2. Open SmartPerfetto sidebar (aware of current Trace)
3. Switch between UI and CLI:
   - **UI**: Visual exploration, manual inspection
   - **CLI**: Ask questions, execute SQL, get explanations
4. AI can operate UI (execute SQL, highlight regions, navigate)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Perfetto UI                        │
├─────────────┬───────────────────────────────────────┤
│   Timeline  │          AI Sidebar                    │
│             │  ┌─────────────────────────────────┐  │
│   [Trace]   │  │ > /help                         │  │
│             │  │                                 │  │
│   [Panels]  │  │ [AI Response...]                │  │
│             │  │                                 │  │
│             │  └─────────────────────────────────┘  │
└─────────────┴───────────────────────────────────────┘
         │                              │
         │          Engine API           │
         └──────────  ┌──────────────────┘
                      │
         ┌────────────▼─────────────┐
         │    AI Service             │
         │  • Local (Ollama)         │
         │  • Remote (OpenAI API)    │
         └───────────────────────────┘
```

### Components

1. **Perfetto UI Extension** (sidebar panel)
   - Integrated via Perfetto plugin system
   - Toggleable panel next to Mega button
   - Uses Perfetto's `Engine` API for queries

2. **Local AI Service**
   - User runs Ollama locally (localhost:11434)
   - Direct frontend calls (no backend needed)
   - Support multiple models (Llama 3.4, Qwen, DeepSeek)

3. **Remote AI Option**
   - User-configured API endpoint
   - OpenAI-compatible接口
   - Fallback option when local unavailable

4. **Bridge Layer**
   - Converts user input to Perfetto API calls
   - Injects Trace context into AI prompts
   - Manages conversation history and state

---

## Interaction Mode

### Hybrid Command Interface

```
> 什么是 Binder？
[AI] Binder 是 Android 的进程间通信机制...

> /sql SELECT * FROM slice WHERE name = 'binder_transaction'
[Result] 23 rows found, highlighted on Timeline

> /goto 123456789
[Navigate] Jumped to timestamp 123456789

> 帮我分析这段卡顿
[AI] 根据当前选中区域，主线程阻塞 500ms，原因是...
```

### Commands

| Command | Description |
|---------|-------------|
| `/sql <query>` | Execute SQL and display results |
| `/goto <ts>` | Jump to timestamp |
| `/select <id>` | Select a slice/track |
| `/analyze` | Analyze current selection |
| `/anr` | Quick ANR detection |
| `/jank` | Quick jank detection |
| `/help` | Show all commands |
| `/model <name>` | Switch AI model |
| `/settings` | Open settings panel |

### AI Context Awareness

- Current Trace metadata (device, Android version, duration)
- User's selected time range
- User's selected slice/track
- Recent SQL queries
- Conversation history (configurable, default 10 rounds)

---

## Core Components

### AIPanel Component

```typescript
interface AIPanelProps {
  engine: Engine;           // Perfetto Engine
  traceInfo: TraceInfo;     // Current Trace info
}

interface AIPanelState {
  messages: Message[];      // Conversation history
  inputMode: 'command' | 'chat';
  context: TraceContext;    // Current selection context
}
```

### CommandParser Module

- Parse user input, distinguish commands vs chat
- Validate command syntax
- Extract parameters

### TraceContextTracker Module

- Listen to Perfetto UI events (selection changes, time range changes)
- Maintain current context state
- Generate context string for AI injection

### AIService Interface

```typescript
interface AIService {
  chat(messages: Message[], context: TraceContext): Promise<string>;
  supports(model: string): boolean;
}

class OllamaService implements AIService { }
class OpenAIService implements AIService { }
```

### ResultRenderer Component

- Render different AI response types:
  - Plain text (Markdown)
  - SQL results (table + chart options)
  - Action suggestions (execute, navigate, copy)

---

## Data Flow

```
User Input
    │
    ▼
CommandParser
    │
    ├── Is Command? ─Yes──→ CommandExecutor → Perfetto API → Result
    │                      No
    ▼
Build AI Prompt
    │
    ├→ System Prompt (role + available tools)
    ├→ Trace Context (device, selection, recent queries)
    ├→ Conversation History (last N rounds)
    └→ User Question
    │
    ▼
AIService (local or remote)
    │
    ▼
AI Response
    │
    ├→ Contains SQL? → Auto-execute → Render results
    ├→ Contains action? → Execute (jump/select)
    └→ Plain text → Markdown render
```

### System Prompt Template

```
你是 Android 性能分析专家助手，帮助用户分析 Perfetto Trace。

可用工具：
- /sql <query> - 执行 SQL 查询
- /goto <timestamp> - 跳转时间戳
- /analyze - 分析当前选中区域

当前 Trace 上下文：
{{deviceInfo}}, {{androidVersion}}, {{traceDuration}}
用户选中：{{selectedSlice}} / {{timeRange}}

根据用户水平自动调整解释深度。
```

---

## Settings & Configuration

### Settings Panel

```
┌─ AI Settings ──────────────────────┐
│                                      │
│ AI Provider                          │
│ ○ Local AI (Ollama)                 │
│ ○ Remote API (OpenAI compatible)    │
│                                      │
│ Endpoint: http://localhost:11434     │
│ Model: llama3.4                      │
│                                      │
│ [Test Connection]                    │
│                                      │
│ Interaction Settings                 │
│ Max history rounds: [10]             │
│ Auto-detect issues: ✓                │
│                                      │
└──────────────────────────────────────┘
```

### Configuration

- Stored in `localStorage`
- Support export/import config
- Default: Try local Ollama, fallback to setup wizard

### First-Time Flow

1. User opens AI panel
2. Detect local AI connection
3. If available, use directly; else show setup wizard
4. Provide quick test command (`/test`) to verify

---

## Perfetto Integration Points

### Utilized Perfetto APIs

| API | Usage |
|-----|-------|
| `engine.runQuery(sql)` | Execute SQL queries |
| `engine.queryResultAsTables(result)` | Get table data |
| `SelectionManager` | Get user selection |
| `navigateToTimestamp(ts)` | Jump navigation |
| `focusOnSlice(id)` | Focus on slice |
| `zoomToRange(start, end)` | Zoom timeline |

### Plugin Registration

```typescript
// perfetto/ui/src/plugins/com.smartperfetto.ai/
export const plugin = {
  onActivate(ctx: PluginContext) {
    const engine = ctx.engine;
    const sidebar = ctx.createSidebarPanel({
      icon: 'terminal',
      title: 'AI Assistant',
      component: AIPanel,
      props: { engine }
    });
  }
};
```

### Event Subscriptions

- `selectionChanged` - Update context when user selects
- `traceLoaded` - Reset on new trace
- `queryExecuted` - Track for context

---

## Error Handling

| Error Type | Handling |
|------------|----------|
| AI service unavailable | Show error + diagnostic steps + offer switch |
| SQL execution failed | Send error to AI for correction, retry (max 3) |
| Query timeout | Suggest narrowing time range, stream partial results |
| Context window exceeded | Auto-trim history, prompt user for larger model |

### Edge Cases

| Situation | Response |
|-----------|----------|
| No trace loaded | "请先打开 Trace 文件" |
| No user selection | Analyze full trace |
| Empty SQL result | AI explains "当前条件下无数据" |
| Non-Perfetto question | Politely redirect to performance analysis |

---

## Implementation Priority

### Phase 1 - Foundation
- [ ] Perfetto plugin registration + sidebar UI
- [ ] Command parser (`/sql`, `/goto`, `/help`)
- [ ] Basic message display (plain text)
- [ ] Local AI connection (Ollama)

### Phase 2 - Core Interaction
- [ ] AI Q&A (without context)
- [ ] Trace context injection (device info, time range)
- [ ] SQL execution + result display
- [ ] Command history (up/down arrow)

### Phase 3 - Intelligence
- [ ] AI aware of user selection
- [ ] Auto issue detection (ANR, Jank)
- [ ] Quick commands (`/anr`, `/jank`)
- [ ] Markdown rendering (code, tables)

### Phase 4 - Polish
- [ ] Remote AI support
- [ ] Settings panel
- [ ] Conversation history persistence
- [ ] Auto SQL correction on error

### Out of Scope (Deferred)

- Multi-language support
- Custom prompt templates
- Share/export conversations
- Team collaboration

---

## Target Users

All levels of Android developers - AI adjusts explanation depth based on question complexity:

- **Beginners**: Detailed concept explanations
- **Intermediate**: Quick problem identification
- **Experts**: Deep data analysis and complex queries

---

## Success Metrics

1. User can open Perfetto UI and start asking questions within 30 seconds
2. AI provides accurate SQL for common queries (90%+ success rate)
3. Context awareness works correctly (selection, time range)
4. Local AI works offline after initial model download
