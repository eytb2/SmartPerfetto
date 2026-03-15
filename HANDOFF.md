# SmartPerfetto Handoff Guide

Cross-session continuity document. Read this when starting a new session on unfamiliar ground.

## Current State (2026-03-14)

- **Primary runtime:** agentv3 (Claude Agent SDK) — 15 MCP tools, all 21 characteristic gaps fixed
- **agentv2:** Soft-deprecated, only activated by `AI_SERVICE=deepseek`
- **Perfetto submodule branch:** `codex/assistant-conversation-step-sync`
- **Test status:** All 6 canonical traces passing in scene-trace-regression

## Emergency Runbook

| Problem | Fix |
|---------|-----|
| Port conflict (9100-9900) | `pkill -f trace_processor_shell` then retry |
| tsx watch stuck | `./scripts/restart-backend.sh` |
| Both services down | `./scripts/start-dev.sh` |
| SDK session map corrupted | Delete `backend/logs/claude_session_map.json`, restart |
| Old sessions accumulating | Sessions auto-expire (30 min in-memory, 24h on disk) |

## Build Artifacts

- `npm run generate:frontend-types` — auto-run by `start-dev.sh`, generates TypeScript types from backend schemas
- `trace_processor_shell` — built automatically by `start-dev.sh`, cached in `perfetto/out/`
- Frontend build: `perfetto/ui/out/` (auto-rebuilt by `build.js --watch`)

## Submodule Sync

```bash
cd perfetto
git fetch fork
git checkout codex/assistant-conversation-step-sync
# ALWAYS push to fork, NEVER to origin (Google upstream)
git push fork HEAD
```

## Session & Log Files

| Path | Purpose | Retention |
|------|---------|-----------|
| `backend/logs/sessions/*.jsonl` | Per-session analysis logs | Manual cleanup |
| `backend/logs/claude_session_map.json` | SDK session ID mapping | 24h TTL, auto-pruned |
| `backend/logs/session_notes/*.json` | Analysis notes per session | Until session deleted |
| `backend/logs/pattern_memory.json` | Cross-session analysis patterns | 60-day TTL, 200 entries max |

## Key Architectural Decisions

See `memory/MEMORY.md` for detailed history. Key decisions:
- VSync calculations use IQR-filtered mean (not raw mean)
- Self-learning = in-context error-fix pairs (not fine-tuning)
- Agent findings have ~30% false positive rate — always verify before implementing
