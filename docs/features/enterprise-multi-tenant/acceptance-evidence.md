# Enterprise §19 Acceptance Evidence

This file maps README §0.8 total-acceptance bullets to concrete automated
evidence. It is intentionally conservative: load-test items remain open until
they have direct measured evidence.

## Evidence Matrix

| README §0.8 item | Status | Evidence |
| --- | --- | --- |
| 50 online users + 5-15 running runs + stable pending queue | Open | Requires a real load-test environment and `load-test-report.md`. The reusable harness is `backend/src/scripts/enterpriseAcceptanceLoadTest.ts`, and acceptance now requires successful samples from 50 distinct `online-user-*` clients, HTTP error rate within the configured threshold, a successful pre-run runtime baseline sample before `analyze_start`, all requested analysis runs started with `sessionId` / `runId` and without start failures, zero `failed` / `error` / `quota_exceeded` terminal runs, at least two samples with 5-15 running runs, and at least two samples with queued/pending runs instead of only trusting single-point max values. README §0.8 must stay open until a real run records measured evidence. |
| Users cannot guess `traceId` / `sessionId` / `runId` / `reportId` for cross-resource access | Covered | `enterpriseTraceMetadataRoutes.test.ts` asserts cross-workspace and missing trace/file both return 404; `enterpriseReportRoutes.test.ts` asserts cross-workspace and missing reports/exports return 404; `agentRoutesRbac.test.ts` asserts cross-workspace run stream/status return 404; `traceProcessorProxyRoutes.test.ts` hides leases from other workspaces. |
| A delete/cleanup does not affect B running run / active lease | Covered | `enterpriseTraceMetadataRoutes.test.ts` now covers scoped delete + cleanup of workspace A while workspace B keeps a running run, trace metadata, and active frontend lease intact. Existing cleanup/delete blockers also keep active holders/runs from being destroyed. |
| Provider isolation: A personal provider does not affect B; workspace default changes only affect new sessions | Covered | `enterpriseProviderStore.test.ts` covers personal provider activation isolation by user and proves a personal override does not deactivate the workspace default visible to another user. `providerRoutes.test.ts` proves workspace provider routes write workspace-scoped defaults. `agentAnalyzeSessionService.test.ts` proves a workspace default change is used by new sessions while an existing live session remains pinned to its original provider. |
| Provider config changes do not resume the wrong SDK session | Covered | `providerSnapshot.test.ts` proves model/endpoint/secret changes alter the provider snapshot hash without exposing plaintext secrets; `agentAnalyzeSessionService.test.ts` refreshes in-memory SDK sessions and skips persisted SDK snapshot restore when the provider hash changed. |
| SSE fetch-stream reconnects with `Last-Event-ID` | Covered | `agent_sse_transport_unittest.ts` sends replay cursor through the `Last-Event-ID` header; `sessionSseReplay.test.ts` prefers that header over the legacy query cursor; `streamProjector.contract.test.ts` replays only events after the cursor; `agentRoutesRbac.test.ts` replays persisted `analysis_completed` terminal events from DB. |
| Two windows open two traces without pending trace / AI session / SSE / lease cross-talk | Covered | `verifyEnterpriseMultiTenantWindows.test.ts` asserts D1-D10 isolation checks; `session_manager_unittest.ts` stores pending traces with workspace/window-scoped sessionStorage keys, prevents another window from recovering them, merges stale session-cache writes, and isolates cached sessions by workspace. |
| One slow SQL does not directly kill a frontend-owned lease | Covered | `workingTraceProcessor.enterpriseIsolation.test.ts` verifies a wall-clock query timeout destroys only the HTTP request, does not call processor `destroy()`, and leaves status ready; `traceProcessorLeaseModeDecision.test.ts` isolates estimated slow SQL instead of sharing frontend lease work. |
| Memory / SQL learning / case / baseline default to tenant/workspace isolation | Covered | `enterpriseKnowledgeScope.test.ts` scopes RAG retrieval before keyword matching and keeps baseline, project memory, case library, and case graph rows isolated by tenant/workspace; `analysisPatternMemory.test.ts` filters positive, negative, and quick-path SQL-learning patterns by enterprise scope. |
| Tenant export / tombstone / async purge / audit proof all work | Covered | `enterpriseTenantExportRoutes.test.ts` exports a redacted tenant bundle with SHA256 and identity proof plus audit; `enterpriseTenantRoutes.test.ts` creates tombstones, blocks new work, enforces the seven-day purge window, runs async purge with proof hash, keeps audit evidence, and blocks purge while runs or leases are active. |
| Load-test report includes p50/p95, error rate, worker RSS, queue length, and LLM cost | Open | `enterpriseAcceptanceLoadTest.ts` emits these metrics from HTTP samples and `/api/admin/runtime`; acceptance now requires runtime RSS, queue length, measurable LLM cost delta, and an LLM call-count increase from the pre-run runtime baseline. Requires `load-test-report.md` from a real 50-user load run. Current RSS benchmark is separately blocked by missing large traces. |

## Verification Commands

The covered rows are validated by the focused test tier below:

```bash
cd backend
PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" npx jest \
  src/routes/__tests__/enterpriseTraceMetadataRoutes.test.ts \
  src/routes/__tests__/enterpriseReportRoutes.test.ts \
  src/routes/__tests__/agentRoutesRbac.test.ts \
  src/routes/__tests__/traceProcessorProxyRoutes.test.ts \
  src/services/providerManager/__tests__/enterpriseProviderStore.test.ts \
  src/services/providerManager/__tests__/providerRoutes.test.ts \
  src/services/providerManager/__tests__/providerSnapshot.test.ts \
  src/assistant/application/__tests__/agentAnalyzeSessionService.test.ts \
  src/assistant/stream/__tests__/sessionSseReplay.test.ts \
  src/assistant/stream/__tests__/streamProjector.contract.test.ts \
  src/scripts/__tests__/verifyEnterpriseMultiTenantWindows.test.ts \
  src/services/__tests__/workingTraceProcessor.enterpriseIsolation.test.ts \
  src/services/__tests__/traceProcessorLeaseModeDecision.test.ts \
  src/services/__tests__/enterpriseKnowledgeScope.test.ts \
  src/agentv3/__tests__/analysisPatternMemory.test.ts \
  src/routes/__tests__/enterpriseTenantRoutes.test.ts \
  src/routes/__tests__/enterpriseTenantExportRoutes.test.ts \
  --runInBand --forceExit
```

The load-test harness is separately unit-tested by:

```bash
cd backend
PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH" \
  npx jest src/scripts/__tests__/enterpriseAcceptanceLoadTest.test.ts --runInBand
```

Frontend SSE/window storage evidence is additionally covered by the Perfetto UI
plugin unit tests:

```bash
cd perfetto
ui/run-unittests --test-filter 'Agent SSE transport|SessionManager'
```

The full PR gate is still required before landing:

```bash
npm run verify:pr
```
