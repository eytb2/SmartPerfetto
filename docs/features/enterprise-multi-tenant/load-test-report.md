# Enterprise Acceptance Load Test Report

Status: pending real 50-user run.

This file is the canonical destination for README §0.8 load-test evidence. It
is intentionally not marked complete yet: no real 50-online-user run has been
executed in this environment.

## Required Evidence

The final report must cover:

- 50 distinct online users with successful sampled requests.
- A successful runtime dashboard baseline sampled before the first
  `analyze_start` request.
- All requested analysis runs start successfully with `sessionId` / `runId`
  evidence, without start failures, and with directly auditable rows in the
  final `Analysis Runs` table.
- No analysis run ends in `failed`, `error`, or `quota_exceeded`.
- 5 to 15 simultaneously running analysis runs, observed in at least two
  polling samples.
- Additional queued or pending runs, observed in at least two polling samples.
- At least 1,000 visible trace metadata entries in the target workspace trace
  list.
- p50 and p95 HTTP latency.
- Error rate within the configured threshold.
- worker / lease RSS.
- queue length.
- LLM cost delta, an LLM call-count increase from the pre-run runtime
  baseline, and at least 200 estimated LLM calls per day when projected from
  the measured load-test window.

## Command

Before the real run, use preflight mode to verify the target environment without
starting analysis runs or simulating 50 online clients. This is only an
environment-readiness check; it is not §0.8 acceptance evidence:

```bash
PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" \
  npm run benchmark:enterprise-load -- \
  --preflight-only \
  --base-url http://localhost:3000 \
  --tenant-id tenant-a \
  --workspace-id workspace-a \
  --users 50 \
  --target-running 15 \
  --target-pending 10 \
  --trace-id <existing-trace-id> \
  --output test-output/enterprise-acceptance-load-preflight.json \
  --markdown test-output/enterprise-acceptance-load-preflight.md
```

Run from `backend/` with Node 24 against a prepared enterprise backend, at
least 1,000 visible trace metadata entries in the target workspace, and at
least one configured trace id that exists in that workspace:

```bash
PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" \
  npm run benchmark:enterprise-load -- \
  --base-url http://localhost:3000 \
  --tenant-id tenant-a \
  --workspace-id workspace-a \
  --users 50 \
  --target-running 15 \
  --target-pending 10 \
  --max-error-rate 0.01 \
  --duration-ms 300000 \
  --trace-id <existing-trace-id> \
  --confirm-real-run \
  --output test-output/enterprise-acceptance-load-test.json \
  --markdown ../docs/features/enterprise-multi-tenant/load-test-report.md
```

If the backend requires `SMARTPERFETTO_API_KEY`, add:

```bash
  --api-key "$SMARTPERFETTO_API_KEY"
```

## Current State

- Harness: `backend/src/scripts/enterpriseAcceptanceLoadTest.ts`
- Unit coverage: `backend/src/scripts/__tests__/enterpriseAcceptanceLoadTest.test.ts`
- README §0.8 load-test rows remain open until a real run overwrites this file
  with measured output and `acceptance.passed = true` in the JSON report.
- `acceptance.passed` requires observing successful requests from 50 distinct
  `online-user-*` clients; the configured `--users` value alone is not enough.
- HTTP error rate must be at or below `--max-error-rate` (default `0.01`).
- The first successful runtime dashboard sample must occur before the first
  `analyze_start`, so later runtime samples cannot masquerade as the pre-run
  baseline.
- All requested `target-running + target-pending` analysis runs must start
  successfully and return `sessionId` / `runId`; any start failure or missing
  identifier keeps the report open.
- Any terminal `failed`, `error`, or `quota_exceeded` analysis run keeps the
  report open, even when HTTP, queue, and cost samples are otherwise present.
- `acceptance.passed` also requires at least two status samples with 5-15
  running runs and at least two status samples with queued/pending runs, so a
  single transient spike cannot satisfy the "stable pending queue" requirement.
- The harness samples the runtime dashboard once before starting analysis runs
  and then during the test window. Runtime evidence must include a measurable
  LLM cost delta plus an increased LLM call count; historical positive cost or
  call totals are not enough evidence that this run exercised a real LLM.
- `--preflight-only` checks load shape, trace list access, at least 1,000
  visible trace metadata entries, configured traceId visibility, runtime
  dashboard access, queue/RSS counters, and LLM counters without starting
  analysis runs. A passing preflight only means the environment is ready for
  the real command; it does not close either README §0.8 row.
- A real run refuses to start unless `--confirm-real-run` is present. This
  forces the environment confirmation step required by `agent-goal.md` §6 before
  the script starts analysis runs or simulates 50 online clients.
