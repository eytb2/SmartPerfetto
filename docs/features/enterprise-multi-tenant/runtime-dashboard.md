# Enterprise Runtime Dashboard

本文件记录 §0.5.8 的管理员运行时 dashboard 后端契约。v1 控制面先暴露
JSON dashboard API；完整租户 / workspace 管理 UI 仍归 §0.5.1。

## Endpoint

```text
GET /api/admin/runtime
```

访问要求：

- 统一经过 `RequestContext`。
- 需要 `runtime:manage` 权限。
- 返回数据只按当前 `tenantId/workspaceId` scope 聚合。

## Payload

Dashboard 覆盖 §0.5.8 要求的五类信号：

- `leases`: scoped active leases、holder 数、holder type、lease RSS、每个 lease 的 queue length。
- `processors`: scoped processor RSS、SQL worker P0/P1/P2 queue totals、RAM budget。
- `events`: scoped recent `agent_events` 与同 tenant / 当前 workspace 的 recent `audit_events`。
- `llmCost`: 进程内 `ModelRouter` usage stats，包含 calls / tokens / cost / failures。
- `scope`: 本次请求解析出的 tenant / workspace / user。

为避免 secret 泄漏，payload 不返回 provider secret、prompt body、SSE payload body、
trace file path 或 audit metadata。

## Verification

最小回归：

```bash
cd backend && npx jest --runInBand src/routes/__tests__/enterpriseRuntimeDashboardRoutes.test.ts
```

PR 前仍需运行：

```bash
npm run verify:pr
```
