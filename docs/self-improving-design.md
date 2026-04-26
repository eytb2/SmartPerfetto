# SmartPerfetto Self-Improving Design (v3.3)

**Status**: Approved 2026-04-26 after 4 rounds of Codex review.
**Owner**: Chris
**Last Updated**: 2026-04-26

This document is the canonical design reference for the Self-Improving feature, inspired by Hermes Agent's three-subsystem architecture (Memory / Skill / Nudge Engine) but adapted to SmartPerfetto's data-pipeline nature where skills are SQL queries (correctness-critical), not procedural Markdown guides.

---

## 1. Design Philosophy

| Hermes Principle | SmartPerfetto Adaptation |
|---|---|
| Background fork review agent | Adopted — independent Claude SDK query, never resumes main session |
| Local patch + security scan + rollback | Adopted, but elevated bar: regression test must pass before persisting |
| Capacity ceiling forces compression | Adopted — bucket-aware quotas on `analysisPatternMemory` |
| Edits SKILL.md (procedural guides) | **Rejected** — never edit `.skill.yaml`. Only sidecar `.notes.json` |
| Memory of user preferences | Deferred — SmartPerfetto is single-tenant analysis platform, not 1-on-1 tool |

**Core principle**: Layer by risk. Low-risk closes existing infrastructure gaps. High-risk gates behind regression tests + human review.

---

## 2. Four-Layer Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Trace Analysis (claudeRuntime.analyze)                      │
└─────────────┬────────────────────────────────────────────────┘
              │ analysis_completed event
              ▼
┌──────────────────────────────────────────────────────────────┐
│  L1 — Inline Closure (PR1, PR2, PR4, PR5)                    │
│  - saveAnalysisPattern: full + quick path coverage           │
│  - Per-turn pattern + state machine                          │
│  - Positive/negative bucket separation                       │
│  - SQL error-fix pairs 5→10 + token budget chain             │
│  - Feedback reverse lookup via SessionStateSnapshot          │
└─────────────┬────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────┐
│  L2 — Background Review Agent (PR6, PR7, PR8)                │
│  - SQLite outbox (atomic lease, dedupe by hash)              │
│  - Independent Claude SDK (no session map collision)         │
│  - Strict JSON output (LLM never writes files)               │
│  - Skill notes sidecar (.notes.json in logs/, not git)       │
│  - Token budget per path (full 1500 / quick 0 / retry 0)     │
│  - Shadow mode by default (write-only until human review)    │
└─────────────┬────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────┐
│  L3 — Strategy Phase-Hints Auto-Patch (PR3, PR9a/b/c)        │
│  - StrategyVersionFingerprint + patchFingerprint             │
│  - Worktree-isolated regression test                         │
│  - PR creation (NEVER auto-merge)                            │
│  - active_canary observation window (7 days / 5 runs)        │
│  - Recurrence detection auto-rollback                        │
│  - Phase hints template-driven (LLM never writes YAML)       │
└─────────────┬────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────┐
│  L4 — Skill SQL Auto-Patch (NOT IMPLEMENTED)                 │
│  - Empty stub returning NOT_IMPLEMENTED_YET                  │
│  - Reserved as future option                                 │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Failure Taxonomy (PR4, foundational)

The single most important design decision: **all three learning artifacts share a `failureModeHash`**.

### 3.1 FailureCategory Enum

```typescript
enum FailureCategory {
  misdiagnosis_vsync_vrr,
  misdiagnosis_buffer_stuffing,
  sql_missing_table,
  sql_missing_column,
  skill_empty_result,
  tool_repeated_failure,
  phase_missing_deep_drill,
  unknown,  // new failure modes default here; never triggers supersede
}
```

LLMs may **only choose from this enum** + fill `evidenceSummary`. They may not invent categories.

### 3.2 computeFailureModeHash

```typescript
function computeFailureModeHash(input: {
  sceneType: SceneType;
  archType: ArchitectureType;
  category: FailureCategory;
  toolOrSkillId?: string;
  errorClass?: string;
}): string;
```

Hash inputs are **only stable enum fields**. `canonicalSymptom` and other LLM-generated text are explanation/audit fields, **never participate in hashing**.

### 3.3 Three learning artifacts using shared hash

| Artifact | Storage | Origin |
|---|---|---|
| `NegativePatternEntry` | `analysis_negative_patterns.json` | Claude runtime fail/feedback |
| `LearnedMisdiagnosisPattern` | `learned_misdiagnosis_patterns.json` | Verifier LLM feedback |
| `SkillNote` | `logs/skill_notes/<skillId>.notes.json` | Background review agent |

Prompt injection deduplicates by `failureModeHash` — same hash, only highest-confidence one is injected.

---

## 4. Pattern State Machine (PR5)

### 4.1 Per-turn primary key

```typescript
interface PatternKey {
  analysisRunId: string;
  sessionId: string;
  turnIndex: number;
  traceContentHash: string;  // sha256 of trace file content (not upload UUID)
}
```

### 4.2 State transitions

```
provisional (default on save)
    ├─→ confirmed (positive feedback within 24h, or auto-promotion)
    ├─→ rejected (negative feedback)
    ├─→ disputed (10s-24h reverse feedback, weight ×0.2)
    └─→ disputed_late (>24h reverse, audit-only revision)
```

### 4.3 Reverse-feedback time windows

| Window | Behavior |
|---|---|
| <10 seconds | Last-write-wins + audit (treated as misclick) |
| 10s-24h | → `disputed`, injection weight ×0.2 |
| >24h | New revision recorded, NOT auto-flips state, → `disputed_late` |

### 4.4 Injection weights

| State | Weight |
|---|---|
| `confirmed` | ×1.0 |
| `provisional` | ×0.5 |
| `disputed` / `disputed_late` | ×0.2 |
| `rejected` | excluded from injection |
| `superseded` (PR9b) | ×0.1 |
| `superseded.active_canary` | ×0.5 |
| `superseded.failed` | restored to ×1.0 |
| `superseded.drifted` | ×0.5 |
| `superseded.reverted` | restored to ×1.0 |
| Quick-path bucket entry | ×0.3 |

---

## 5. Bucket Separation (PR5)

Positive and negative patterns use **different bucket key formulas**:

| Bucket | Key Formula | Reason |
|---|---|---|
| Positive | `${sceneType}::${archType}::${domainHash}` | Domain (e.g. `tencent` from `com.tencent.mm`) groups similar app behaviors |
| Negative | `${sceneType}::${archType}::${failureModeHash}` | Failure modes are the natural grouping for "what went wrong" |
| Quick-path | `${sceneType}::${archType}::quick_recent` | Short TTL (7d), separate from long-term memory |

Per-bucket quota: 10-50 entries. Global cap: 200 positive / 100 negative (eviction prefers high-quota buckets' low matchCount entries).

---

## 6. Quick-Path Promotion (PR5)

Quick path writes to `quick_pattern_recent` bucket. To promote to long-term memory:

1. Same `sceneType + archType + domainHash`
2. Weighted Jaccard similarity ≥ 0.65
3. Full-path verifier passed
4. At least one matching insight/finding category
5. Quick pattern has no negative/disputed feedback
6. (Bonus) full `packageName` matches

Promoted entry is a **new long-term pattern**, not the quick entry itself.

---

## 7. SQLite Outbox (PR6)

Independent DB: `backend/data/self_improve.db` (NOT mixed with sessions DB).

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE review_jobs (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('pending','leased','done','failed')),
  dedupe_key TEXT NOT NULL,    -- sessionId::turnIndex::skillId::failureModeHash
  priority INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  lease_owner TEXT,
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  last_error TEXT
);
CREATE INDEX idx_state_priority ON review_jobs(state, priority DESC, created_at);
CREATE UNIQUE INDEX idx_dedupe_active ON review_jobs(dedupe_key) WHERE state IN ('pending','leased');
```

All ops in transactions. `enqueue` failure must NOT block main analysis. Atomic lease via `UPDATE ... WHERE state='pending' RETURNING ... LIMIT 1`.

---

## 8. Token Budget (PR8)

**Unit**: estimated tokens (not bytes — Chinese chars are larger).

| Path | Total | Per-Skill | Same-Skill Same-Analysis |
|---|---|---|---|
| Full | 1500 | 200 | Once |
| Quick | 0 (env override max 100) | 0 | N/A |
| Correction retry | 0 | 0 | N/A |

Priority chain (drop order, lowest first):
1. P0 (kept): watchdog warning
2. P1: verifier correction prompt
3. P2: negative pattern context
4. P3 (drop first): skill notes

Skill notes that exceed budget → silent drop + metric, no error.

---

## 9. Trust Boundary (PR7)

The review agent is a **Claude SDK query**, not a runtime extension. It runs:

- Independent SDK process (`sdkQuery()` direct, no `ClaudeRuntime.analyze`)
- Independent session ID (does NOT resume main session)
- **Does NOT write to `claude_session_map.json`**
- No `Write` tool exposed
- No file-system access via MCP
- 90s wall timeout, 8 turn cap
- Default model: `CLAUDE_LIGHT_MODEL` (haiku 4.5)

Review agent's only output: strict JSON conforming to schema. Backend does:
1. JSON schema validation
2. `failureCategoryEnum` whitelist check
3. `contentScanner` security scan (6 threat patterns)
4. Capacity check (size limits)
5. Atomic file write to `logs/skill_notes/`

---

## 10. Worker Resource Limits (PR7)

| Limit | Default | Env Override |
|---|---|---|
| Concurrency | 1 | `SELF_IMPROVE_WORKER_CONCURRENCY` (max 2) |
| Queue length cap | 100 | `SELF_IMPROVE_QUEUE_MAX` |
| Per-skill+hash cooldown | 5 min | `SELF_IMPROVE_SKILL_COOLDOWN_MS` |
| Daily job budget | 100 | `SELF_IMPROVE_DAILY_BUDGET` |
| Lease duration | 5 min | `SELF_IMPROVE_LEASE_MS` |
| Retry cap | 3 | `SELF_IMPROVE_MAX_ATTEMPTS` |
| Poll interval | 30s | `SELF_IMPROVE_POLL_INTERVAL_MS` |

No SDK call batching (preserves failure isolation + provenance). Queue age metric; jobs older than threshold dropped (low priority first).

---

## 11. Strategy Version Fingerprint (PR9a)

```typescript
interface StrategyVersionFingerprint {
  strategyFile: string;            // 'scrolling.strategy.md'
  strategyContentHash: string;     // sha256 of file content
  patchFingerprint: string;        // hash of target phase_hints entry only
  gitCommit: string;               // commit on main where this version exists
  appliedAt: number;
}
```

`patchFingerprint` is computed from the targeted `phase_hints` entry's normalized form (sorted `id + keywords + constraints + criticalTools`).

### 11.1 Three-tier drift handling

| Detection | State | Weight |
|---|---|---|
| Whole-file hash changed, patchFingerprint still present | Stay `active` | Unchanged + metric |
| `patchFingerprint` changed | → `drifted` | ×0.1 → ×0.5 |
| Patch entry deleted | → `reverted` | Restored to ×1.0 |

### 11.2 Run snapshot freezing

Each `analyze()` snapshots only the current scene's strategy (KB-level, not all strategies). Mid-analysis `update_plan_phase` reads from this snapshot. `invalidateStrategyCache()` only affects new runs.

---

## 12. Supersede State Machine (PR9b)

```
pending_review (PR created, weight unchanged)
    ├─→ active_canary (PR merged, observation period, weight ×0.5)
    │       ├─→ active (no recurrence after window, weight ×0.1)
    │       └─→ failed (recurrence detected, weight restored 1.0)
    │       └─→ drifted (patchFingerprint changed)
    │       └─→ reverted (git revert detected)
    └─→ rejected (PR closed without merge, weight restored)
```

### 12.1 Observation window

`active_canary` observes for either:
- 7 calendar days, OR
- 5 full-path analyses on same `sceneType + archType`

Whichever comes first.

### 12.2 Recurrence detection

During observation, if a new negative pattern matches the same `failureModeHash`:
1. Supersede marker → `failed`
2. Old negative pattern injection weight restored to ×1.0
3. Metric: `supersede_failed{hash=xxx}` for human review
4. Auto-rollback prevents false-fix from permanently silencing valid patterns

### 12.3 Squash-aware merge

Because PR squash merge changes the commit SHA:
1. On merge event, fetch latest main
2. Read strategy file content from main (post-merge)
3. Recompute `strategyContentHash` + `patchFingerprint`
4. Use main's `gitCommit` (not PR branch's)
5. Write `active_canary` marker

### 12.4 PR status sync

- Background poll every 10 min, batch query all `pending_review` PRs
- `analyze()` only triggers a check if last poll > 10 min ago
- Optional GitHub webhook (idempotent with poller)
- Never per-analyze GitHub call

---

## 13. Phase Hints Template-Driven Patching (PR9c)

LLM **never writes YAML directly**. Instead:

1. Templates indexed by `failureCategoryEnum`: `backend/strategies/phase_hint_templates/<category>.template.yaml`
2. Review agent outputs strict JSON:
   ```json
   {
     "failureCategoryEnum": "misdiagnosis_vsync_vrr",
     "evidenceSummary": "...",
     "candidateKeywords": ["vsync", "vrr"],
     "candidateConstraints": "必须先调用 vsync_dynamics_analysis",
     "candidateCriticalTools": ["vsync_dynamics_analysis"]
   }
   ```
3. Backend validation:
   - `failureCategoryEnum` ∈ whitelist
   - `candidateKeywords` length-bounded
   - `candidateConstraints` passes `contentScanner`
   - `candidateCriticalTools` exist in tool/skill registry
4. Backend renders **deterministic** YAML (same input always → same output)
5. No template for category → no auto-patch, generate human-readable suggestion only

### 13.1 Single-file patch only (first version)

One `failureModeHash` + one `strategyFile` + one PR. Multi-file patches NOT supported in v1.

### 13.2 Worktree isolation

```bash
git worktree add /tmp/sp-autopatch-<jobId> main
# apply patch in worktree
# run validate:strategies
# run test:scene-trace-regression
# run e2e startup + scrolling
# all pass → push branch + create PR
git worktree remove /tmp/sp-autopatch-<jobId>
```

DB lock: same `strategyFile` OR same `failureModeHash` → only one active job at a time.

---

## 14. Feature Flags

All flags default `false`. Three-stage rollout:

| Flag | Stage | Behavior |
|---|---|---|
| `SELF_IMPROVE_REVIEW_ENABLED` | Stage 1 | Worker runs, calls review agent SDK |
| `SELF_IMPROVE_NOTES_WRITE_ENABLED` | Stage 1 | Backend writes JSON to `logs/skill_notes/` |
| `SELF_IMPROVE_NOTES_INJECT_ENABLED` | Stage 2 | `invoke_skill` injects notes into prompts |
| `SELF_IMPROVE_AUTOPATCH_ENABLED` | Stage 3 | PR9c worktree patch creation |

**Shadow mode** = `REVIEW=on, WRITE=on, INJECT=off`. Notes are collected and human-reviewable before agent reads them.

---

## 15. Provenance Schema (all artifacts)

```typescript
interface Provenance {
  schemaVersion: 1;
  sourceSessionId: string;
  sourceAnalysisRunId: string;
  sourceTurnIndex: number;
  traceContentHash: string;
  failureModeHash: string;
  verifierStatus: 'passed' | 'warning' | 'error';
  feedbackStatus: 'provisional' | 'confirmed' | 'rejected' | 'disputed' | 'disputed_late';
  appliedAt: number;
  expiresAt?: number;
  supersededBy?: StrategyVersionFingerprint;
}
```

---

## 16. Testing Strategy

### Per-PR gates (mandatory)
1. `cd backend && npx tsc --noEmit`
2. `cd backend && npm run test:scene-trace-regression` (6 traces)
3. `cd backend && npm run validate:skills` (PR4+ only)
4. `cd backend && npm run validate:strategies` (PR9+ only)

### E2E gates (mandatory for L3 changes / strategy changes)
- Startup: `verifyAgentSseScrolling.ts --trace lacunh_heavy.pftrace --query "分析启动性能"`
- Scrolling: `verifyAgentSseScrolling.ts --trace scroll-demo-customer-scroll.pftrace --query "分析滑动性能"`
- Flutter TextureView + SurfaceView (when touching pipeline skills)

### Self-improving regression
- `analysis_patterns.json` / `analysis_negative_patterns.json` schema validity
- Hash collision tests (different inputs → different hashes)
- State machine transition tests
- `contentScanner` threat pattern coverage
- SQLite migration up/down
- Worktree cleanup on patch failure

---

## 17. 4 Rounds of Codex Review — Key Decisions

### Round 1
- Confirmed: `saveAnalysisPattern` already called at `claudeRuntime.ts:1089` (full path)
- Confirmed: SQL error-fix pairs already injected (5 entries) at `claudeSystemPrompt.ts:434`
- Insight: `_MEMORY_THREAT_PATTERNS` does NOT exist in SmartPerfetto (must build new)

### Round 2
- Outbox MUST use SQLite (filesystem lease has race conditions)
- Token budget MUST split full vs quick (quick has no `ArtifactStore`)
- All learning artifacts MUST share `failureModeHash` taxonomy

### Round 3
- `failureModeHash` inputs MUST be enum-only (LLM wording is unstable)
- `dedupe_key` MUST include `failureModeHash` (different failure modes on same skill must not clobber)
- SQLite migration MUST exist from day one (`schema_migrations` table)
- Quick-path pattern MUST go to short-TTL bucket (no long-term contamination)

### Round 4
- `patchFingerprint` MUST be added (whole-file hash too coarse)
- `active_canary` state MUST exist (PR merge ≠ patch actually fixes the issue)
- Phase hints MUST be template-driven (LLM never writes YAML)
- Squash-merge fingerprint MUST be recomputed from main post-merge

---

## 18. Out of Scope

- **L4 Skill SQL auto-patch**: Stub returns `NOT_IMPLEMENTED_YET`. Reserved for future after L1-L3 stabilize.
- **Multi-file phase_hints patches**: Single-file only in v1.
- **Cross-tenant skill notes sharing**: SmartPerfetto is single-tenant.
- **User-preference Memory** (Hermes USER.md): Deferred indefinitely.
- **Auto-merge of L3 PRs**: Forbidden by design. Always human review.

---

## 19. Open Risks (accepted)

1. **`active_canary` 7-day window**: Some failure modes are slow to recur. Mitigated by `failed` state restoration + metric alerts.
2. **`unknown` category accumulation**: New failure modes default to `unknown` and never trigger supersede. Quarterly human triage required to add new enum values.
3. **L2 review agent cost**: ~$1-2.5/day at typical SmartPerfetto load. Acceptable given quality gain.
4. **SQLite contention**: better-sqlite3 sync API on enqueue is acceptable (low-frequency writes per analysis completion). Worker thread reserved for future if metrics show contention.
