<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# Upstream Perfetto AI Skill Translation SOP

This SOP converts upstream `perfetto/ai/skills/*/SKILL.md` runbooks into
SmartPerfetto runtime assets. Do not copy upstream markdown skills into a second
agent skill runtime.

## Translation Rule

| Upstream content | SmartPerfetto target |
|---|---|
| Executable PerfettoSQL | `backend/skills/**/*.skill.yaml` step |
| Investigation order | `backend/strategies/*.strategy.md` phase |
| Caveat / data availability rule | Skill fallback row, optional step, or strategy warning |
| Trace processor mechanics | MCP/tool docs and SQL validator behavior |
| Long-form explanation | `backend/skills/docs/*.sop.md` or strategy note |

## Review Checklist

1. Identify whether the upstream skill contains executable SQL, only workflow
   guidance, or environment setup instructions.
2. Reject any Google-internal or repo-relative dependency unless SmartPerfetto
   already has an equivalent public/local path.
3. Prefer stdlib modules over raw table joins. When raw tables are required,
   keep selected columns explicit.
4. Add an availability step before deep analysis when the required trace signal
   may be absent.
5. Keep deterministic evidence in YAML Skill output. Keep interpretation rules
   in strategies or docs.
6. Add focused eval coverage for both data-present and no-data contracts when
   fixtures exist. If only no-data fixtures exist, assert the empty contract.
7. Run `validate:skills`, relevant skill evals, `typecheck`, `build`, and the
   repository PR gate before pushing.

## Current Mappings

| Upstream skill | SmartPerfetto mapping | Status |
|---|---|---|
| `perfetto-infra-querying-traces` | SQL stdlib docs/lineage lookup, auto-include validator, MCP SQL guidance | Implemented |
| `perfetto-infra-getting-trace-processor` | Existing local `trace_processor_shell` pool and setup docs; no runtime skill copy | Documented |
| `perfetto-workflow-android-heap-dump` | `android_heap_graph_summary`, `android_bitmap_memory_per_process`, memory strategy heap graph guidance | Implemented |

## Acceptance

A translation is complete only when the SmartPerfetto asset can be invoked by
the existing Skill/strategy runtime and its output contract is tested. A markdown
note alone is not enough unless the upstream source has no executable analysis
surface.
