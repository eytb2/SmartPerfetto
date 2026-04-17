<!--
SPDX-License-Identifier: AGPL-3.0-or-later
Copyright (C) 2024-2026 Gracker (Chris)
This file is part of SmartPerfetto. See LICENSE for details.
-->

# SmartPerfetto CLI

Terminal-based access to the agentv3 analysis pipeline — no Perfetto UI
and no HTTP server needed. Every analysis creates (or continues) a folder
under `~/.smartperfetto/sessions/<id>/` containing the conclusion,
per-turn markdown, a transcript, and an HTML report.

The CLI ships inside the `smart-perfetto-backend` package as the
`smartperfetto` binary. For development you can use `npm run cli:dev`
or the `backend/scripts/smartperfetto-dev` wrapper, which runs the
TypeScript sources directly via `tsx`.

## Install

```bash
cd backend
npm install
npm link          # exposes `smartperfetto` on PATH
```

Requires `ANTHROPIC_API_KEY` (or `ANTHROPIC_BASE_URL` for proxy setups)
readable from one of:

1. `--env-file <path>` argument
2. `backend/.env` (auto-detected by walking up from the binary)
3. `~/.smartperfetto/env`

## Two ways to use it

### REPL (default — no sub-command)

```bash
smartperfetto                          # enter the REPL
smartperfetto --resume <sessionId>     # REPL with a session preloaded
```

Inside the REPL:

| Command | What it does |
|---|---|
| `/load <trace>` | Load a trace file and run the first turn |
| `/ask <question>` | Ask a follow-up on the current session |
| `<question>` | Shorthand for `/ask` (no slash required) |
| `/resume <id>` | Switch to a different existing session |
| `/report [--open]` | Print or open the current session's HTML report |
| `/focus` | Show the current session's metadata |
| `/clear` | Clear the terminal scrollback |
| `/help` | Slash-command reference |
| `/exit` / `/quit` | Leave the REPL (or press Ctrl+C twice within 1.5s) |

Multi-line input: end any line with `\` to continue on the next. A bare
`\` on an otherwise empty line cancels continuation.

### One-shot subcommands (scripts / CI)

| Command | Purpose |
|---|---|
| `smartperfetto analyze <trace> [--query "…"]` | Run one turn and exit |
| `smartperfetto resume <id> --query "…"` | Append one follow-up turn |
| `smartperfetto list [--json] [--limit N] [--since <date>]` | List stored sessions |
| `smartperfetto show <id> [--open]` | Print the latest conclusion and report path |
| `smartperfetto report <id> [--open]` | Print or open the HTML report |
| `smartperfetto rm <id> [--yes]` | Delete the local session folder |

Global flags available on every command:

| Flag | Default | Purpose |
|---|---|---|
| `--session-dir <path>` | `~/.smartperfetto` | Override session storage root |
| `--env-file <path>` | auto-detected | Explicit `.env` to load |
| `--verbose` | off | Show raw tool-dispatch / agent-response events |
| `--no-color` | off | Disable ANSI colors (or set `NO_COLOR=1`) |

## Session folder layout

```
~/.smartperfetto/
├── index.json                       (global session catalog)
└── sessions/
    └── <sessionId>/
        ├── config.json              (ids, trace path, turn count, last-update)
        ├── conclusion.md            (latest turn's conclusion — `cat`-friendly)
        ├── transcript.jsonl         (one line per turn: question, confidence, report path)
        ├── stream.jsonl             (raw StreamingUpdate events, append-only)
        ├── report.html              (latest HTML report — openable standalone)
        └── turns/
            ├── 001.md               (turn 1 full answer)
            ├── 002.md               (turn 2, ...)
            └── ...
```

The folder is self-contained — it can be copied, shared, or backed up
independently. Only `config.json` is required by `resume`; the rest
are produced for human readers.

## Resume semantics

`resume` tries three strategies, in order:

1. **Full resume** — if `backend/uploads/traces/<traceId>.trace` is
   still on disk, re-attach to it with the original traceId. The SDK's
   conversation context is pulled from `backend/data/claude_session_map.json`
   and Claude continues the same thread.
2. **SDK-context-expired** — same trace, but Claude's own session has
   been dropped. Silently starts a new SDK session; the CLI doesn't
   try to detect this separately from case 1.
3. **Trace evicted** — load fresh from the original `tracePath`. The
   prior `conclusion.md` is trimmed to ~1.5 KB and injected as a
   preamble so the new run has content-level context, even though the
   SDK thread is new. A `note:` line is printed so you know it happened.

If the trace file at `tracePath` has also been moved, `resume` fails
and tells you to use `analyze` on the new location.

## Non-TTY / CI usage

- `smartperfetto list/show/report/rm` do **not** require LLM credentials
  — safe to run in environments where `ANTHROPIC_API_KEY` is not set.
- `rm` without `--yes` refuses to run on a non-TTY stdin to avoid
  hanging on a confirmation prompt that will never arrive.
- `list --json` produces clean JSON (no dotenv tip lines) suitable for
  piping into `jq`.

## Known limitations (PR1-3)

- Force-exit (Ctrl+C twice during an active turn) may orphan the
  Claude Agent SDK subprocess until its own timeout fires. Clean up
  with `pkill -f trace_processor_shell` if needed.
- Windows is not supported — the CLI assumes `open` (macOS) or
  `xdg-open` (Linux) for the `--open` flag.
- `report --rebuild` (regenerate HTML from `stream.jsonl`) is not
  implemented yet — for now, rerun `analyze` / `resume` to get a
  fresh report.
