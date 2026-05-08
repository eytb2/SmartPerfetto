# Enterprise Acceptance Load Test Report

Status: pending real 50-user run.

This file is the canonical destination for README §0.8 load-test evidence. It
is intentionally not marked complete yet: no real 50-online-user run has been
executed in this environment.

## Required Evidence

The final report must cover:

- 50 distinct online users with successful sampled requests.
- All requested analysis runs start successfully without start failures.
- No analysis run ends in `failed`, `error`, or `quota_exceeded`.
- 5 to 15 simultaneously running analysis runs, observed in at least two
  polling samples.
- Additional queued or pending runs, observed in at least two polling samples.
- p50 and p95 HTTP latency.
- Error rate within the configured threshold.
- worker / lease RSS.
- queue length.
- LLM cost delta and an LLM call-count increase from the pre-run runtime
  baseline.

## Command

Run from `backend/` with Node 24 against a prepared enterprise backend and at
least one already uploaded trace in the target workspace:

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
- All requested `target-running + target-pending` analysis runs must start
  successfully; any start failure keeps the report open.
- Any terminal `failed`, `error`, or `quota_exceeded` analysis run keeps the
  report open, even when HTTP, queue, and cost samples are otherwise present.
- `acceptance.passed` also requires at least two status samples with 5-15
  running runs and at least two status samples with queued/pending runs, so a
  single transient spike cannot satisfy the "stable pending queue" requirement.
- The harness samples the runtime dashboard once before starting analysis runs
  and then during the test window. Runtime evidence must include a measurable
  LLM cost delta plus an increased LLM call count; historical positive cost or
  call totals are not enough evidence that this run exercised a real LLM.
