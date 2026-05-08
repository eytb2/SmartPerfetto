# Enterprise Admin Control Plane

本文件记录 §0.5.1 的 tenant / workspace / member / provider / quota 管理面。

## UI

后端提供轻量静态管理面：

```text
GET /admin-control-plane
```

该页面面向已通过企业鉴权的管理员，覆盖：

- tenant summary
- workspace 列表与创建
- workspace quota / retention policy 更新
- workspace member upsert
- provider 管理入口提示

## API

Tenant / workspace / member / quota 管理 API 位于 `/api/tenant`：

```text
GET   /api/tenant/admin/summary
GET   /api/tenant/workspaces
POST  /api/tenant/workspaces
PATCH /api/tenant/workspaces/:workspaceId
PATCH /api/tenant/workspaces/:workspaceId/policies
GET   /api/tenant/workspaces/:workspaceId/members
PUT   /api/tenant/workspaces/:workspaceId/members/:userId
DELETE /api/tenant/workspaces/:workspaceId/members/:userId
```

Provider 管理复用已落地的 workspace provider API：

```text
GET/POST/PATCH/DELETE /api/workspaces/:workspaceId/providers
```

## Permission Model

- tenant summary、workspace list、workspace create 需要 `org_admin`、`tenant:manage` 或 `*`。
- workspace update、policy update、member 管理允许 `org_admin`、`tenant:manage`、`workspace:manage`、`quota:manage`，或当前 workspace 的 `workspace_admin`。
- tenant tombstone / purge 仍要求 `org_admin`、`tenant:delete` 或 `*`。

## Audit

管理操作写入 `audit_events`：

- `tenant.workspace.created`
- `tenant.workspace.updated`
- `tenant.workspace.policy_updated`
- `tenant.member.upserted`
- `tenant.member.deleted`

## Verification

最小回归：

```bash
cd backend && npx jest --runInBand src/routes/__tests__/enterpriseTenantRoutes.test.ts
```

PR 前仍需运行：

```bash
npm run verify:pr
```
