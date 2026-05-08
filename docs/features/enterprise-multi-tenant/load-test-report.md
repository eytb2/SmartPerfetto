# Enterprise Acceptance Load Test Report

Status: pending real 50-user run.

This file is the canonical destination for README §0.8 load-test evidence. It
is intentionally not marked complete yet: no real 50-online-user run has been
executed in this environment.

## Required Evidence

The final report must cover:

- 50 online users.
- 5 to 15 simultaneously running analysis runs.
- Additional queued or pending runs.
- p50 and p95 HTTP latency.
- Error rate.
- worker / lease RSS.
- queue length.
- LLM cost and call count.

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
