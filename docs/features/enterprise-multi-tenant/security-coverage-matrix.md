# Enterprise Security Coverage Matrix

本文件记录 §0.6.5 的安全测试覆盖证据。范围限定为 README §0.6.5 点名的三类不变量：ID 枚举、跨 tenant/workspace 访问、无权限资源访问按不可枚举路径处理。

## Scope

| §0.6.5 链路 | 自动证据 | 覆盖的不变量 |
| --- | --- | --- |
| traceId 枚举 | `backend/src/routes/__tests__/ownerGuardRoutes.test.ts`、`backend/src/routes/__tests__/enterpriseTraceMetadataRoutes.test.ts` | trace list 按 owner scope 过滤；跨 tenant/workspace trace read/delete/download 和未知 trace 均返回 404，不暴露 scoped trace 是否存在。 |
| sessionId / runId 枚举 | `backend/src/routes/__tests__/ownerGuardRoutes.test.ts`、`backend/src/routes/__tests__/agentRoutesRbac.test.ts` | 跨 tenant session report、跨 workspace session status、跨 workspace run stream 与未知 session/run 均返回 404，不触发 report recovery 或 SSE stream。 |
| reportId 枚举 | `backend/src/routes/__tests__/ownerGuardRoutes.test.ts`、`backend/src/routes/__tests__/enterpriseReportRoutes.test.ts` | report read/export/delete 按 tenant/workspace 和 `report:read` 过滤；跨 workspace report 与未知 report 均返回 404。 |
| provider 无权限访问 | `backend/src/services/providerManager/__tests__/providerRoutes.test.ts` | enterprise SSO 下 analyst/viewer 缺少 `provider:manage_workspace` 时不能 list/read provider 管理面，workspace admin 才能访问。 |
| memory 无权限访问 | `backend/src/routes/__tests__/memoryRoutes.test.ts` | enterprise SSO 下 memory list/audit/delete 管理面要求 `audit:read`；该测试被固定进 `cd backend && npm run test:core`。 |
| scope 过滤 | `backend/src/services/__tests__/enterpriseKnowledgeScope.test.ts`、`backend/src/services/__tests__/enterpriseSchema.test.ts` | Memory/RAG/Case/Baseline 默认按 tenant/workspace 过滤；核心表外键拒绝跨 tenant workspace/session/run 引用。 |
| 证据清单同步 | `backend/src/scripts/__tests__/enterpriseSecurityAuditChecklist.test.ts` | §0.5.9 的安全审计清单、README 状态和 `security-audit.md` 保持同步，避免测试证据漂移。 |

## Verification

最小回归：

```bash
cd backend && npx jest --runInBand --forceExit \
  src/routes/__tests__/ownerGuardRoutes.test.ts \
  src/routes/__tests__/agentRoutesRbac.test.ts \
  src/routes/__tests__/enterpriseTraceMetadataRoutes.test.ts \
  src/routes/__tests__/enterpriseReportRoutes.test.ts \
  src/routes/__tests__/memoryRoutes.test.ts \
  src/services/providerManager/__tests__/providerRoutes.test.ts \
  src/services/__tests__/enterpriseKnowledgeScope.test.ts \
  src/services/__tests__/enterpriseSchema.test.ts \
  src/scripts/__tests__/enterpriseSecurityAuditChecklist.test.ts
```

PR gate 中的固定入口：

```bash
cd backend && npm run test:core
npm run verify:pr
```
