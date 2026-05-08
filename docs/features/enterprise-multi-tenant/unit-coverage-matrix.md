# Enterprise Unit Coverage Matrix

本文件记录 §0.6.1 的单元测试覆盖证据。目标不是新增一套平行测试，而是把企业多租户最小安全边界的关键单测纳入 `test:core`，让 PR gate 每次都覆盖这些契约。

## Scope

| §0.6.1 主题 | 自动证据 | 覆盖的不变量 |
| --- | --- | --- |
| RequestContext | `backend/src/middleware/__tests__/auth.test.ts` | dev / SSO / API key 三种入口都产出 `tenantId`、`workspaceId`、`userId`、roles、scopes；`attachRequestContext` 与 `authenticate` 行为一致。 |
| RBAC | `backend/src/services/__tests__/rbac.test.ts` | workspace 资源访问必须同时满足 role/scope 与 owner guard，API key scope 不能绕过 workspace 归属。 |
| owner guard | `backend/src/routes/__tests__/ownerGuardRoutes.test.ts`、`backend/src/routes/__tests__/agentRoutesRbac.test.ts` | trace / report / agent session 资源在无权或跨 workspace 时不泄漏存在性；agent route 权限按分析链路收敛。 |
| provider resolution | `backend/src/agentRuntime/__tests__/runtimeSelection.test.ts`、`backend/src/assistant/application/__tests__/agentAnalyzeSessionService.test.ts` | active provider、显式 `providerId`、`providerId: null`、persisted snapshot、env/default fallback 的优先级稳定。 |
| ProviderSnapshot hash | `backend/src/services/providerManager/__tests__/providerSnapshot.test.ts`、`backend/src/assistant/application/__tests__/agentAnalyzeSessionService.test.ts` | endpoint / model / secret material 变更会改变 hash；activation-only metadata 不改变 hash；secret 明文不进入 snapshot；hash 变更后不复用旧 SDK session。 |

## Verification

最小回归：

```bash
cd backend && npx jest --runInBand \
  src/middleware/__tests__/auth.test.ts \
  src/services/__tests__/rbac.test.ts \
  src/routes/__tests__/ownerGuardRoutes.test.ts \
  src/routes/__tests__/agentRoutesRbac.test.ts \
  src/agentRuntime/__tests__/runtimeSelection.test.ts \
  src/assistant/application/__tests__/agentAnalyzeSessionService.test.ts \
  src/services/providerManager/__tests__/providerSnapshot.test.ts
```

PR gate 中的固定入口：

```bash
cd backend && npm run test:core
npm run verify:pr
```
