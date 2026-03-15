# Prompt Content Rules

## NEVER hardcode prompt content in TypeScript files

All prompt content must live in Markdown files, never in TypeScript source:

- Scene strategies → `backend/strategies/*.strategy.md` (YAML frontmatter + markdown body)
- Selection context → `backend/strategies/selection-*.template.md` (uses `{{variable}}` placeholders)
- Prompt templates → `backend/strategies/prompt-*.template.md` and `arch-*.template.md`
- TypeScript only does: template loading, variable substitution, structural wiring

## Template system

- `strategyLoader.ts` provides: `getStrategyContent()`, `loadPromptTemplate()`, `loadSelectionTemplate()`, `renderTemplate()`
- `loadSelectionTemplate(kind)` delegates to `loadPromptTemplate('selection-' + kind)` — unified cache
- Variables use `{{variable}}` syntax in templates
- Skill parameters use `${param|default}` syntax in YAML

## Content System (dual-track)

**Path 1: `.md` → System Prompt (Claude's "brain")**
```
classifyScene(query) → SceneType (from strategy.md frontmatter keywords)
    → buildSystemPrompt() → assembles: prompt-role + arch-* + prompt-methodology({{sceneStrategy}}) + selection-* + prompt-output-format
    → System Prompt → Claude Agent SDK
```

**Path 2: `.skill.yaml` → MCP tool execution (Claude's "hands")**
```
invoke_skill(skillId, params) → skillExecutor.execute()
    → YAML steps → ${param|default} substitution → SQL → trace_processor
    → DisplayResult[] (L1-L4) → DataEnvelope → SSE → frontend
```

**Hot reload:** In DEV mode, changes to `.md` or `.yaml` take effect on browser refresh. No backend restart needed.
