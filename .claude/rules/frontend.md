# Frontend Rules

## Plugin location

`perfetto/ui/src/plugins/com.smartperfetto.AIAssistant/`

Key files:
- `ai_panel.ts` — Main UI + Mermaid rendering
- `sql_result_table.ts` — Data table (schema-driven from DataEnvelope)
- `ai_service.ts` — Backend communication
- `chart_visualizer.ts` — Chart visualization
- `navigation_bookmark_bar.ts` — Navigation bookmarks
- `session_manager.ts` — localStorage session persistence
- `sse_event_handlers.ts` — SSE event dispatch (pure functions)
- `types.ts` — AIPanelState, Message, AISession, StreamingFlowState

## Mermaid chart support

- Lazy-load from same-origin `assets/mermaid.min.js` (CSP compliant)
- Base64 encoded chart source in `data-mermaid-b64` attribute
- Error handling + source code collapse display

## Perfetto submodule

This is a forked Google project. See `rules/git.md` for push rules.
