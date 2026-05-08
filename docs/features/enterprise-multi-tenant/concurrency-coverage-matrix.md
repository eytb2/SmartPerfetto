# Enterprise Concurrency Coverage Matrix

本文件记录 §0.6.3 的并发测试覆盖证据。范围限定为多用户同时触发的主链路：upload、analyze、query、cancel、cleanup。

## Scope

| §0.6.3 链路 | 自动证据 | 覆盖的不变量 |
| --- | --- | --- |
| 多用户同时 upload | `backend/src/routes/__tests__/enterpriseTraceMetadataRoutes.test.ts` | 两个用户同时上传同名 trace 时生成不同 traceId，文件分别落到 `data/{tenantId}/{workspaceId}/traces/`，列表只返回当前 workspace 的 trace。 |
| upload 与 cleanup 并发 | `backend/src/routes/__tests__/enterpriseTraceMetadataRoutes.test.ts` | workspace admin cleanup 只扫描当前 workspace；当该 workspace 存在 active frontend holder 时返回 409，不清理其他 workspace 的并发上传结果。 |
| 多用户同时 analyze | `backend/src/routes/__tests__/agentRoutesRbac.test.ts` | 两个 workspace 的分析请求同时创建独立 session/run/lease；一个用户取消自己的 run 不影响另一个 workspace 的 running run。 |
| cancel 隔离 | `backend/src/routes/__tests__/agentRoutesRbac.test.ts` | `POST /api/agent/v1/:sessionId/cancel` 只作用于当前 RequestContext 可访问 session；跨 workspace status 查询统一返回 404。 |
| 并发 query | `backend/src/routes/__tests__/traceProcessorProxyRoutes.test.ts` | 两个并发 `/api/tp/:leaseId/query` 请求都通过同一个 scoped lease 进入 P0 routing，每个响应返回自己的 protobuf body，不串请求上下文。 |

## Verification

最小回归：

```bash
cd backend && npx jest --runInBand --forceExit \
  src/routes/__tests__/enterpriseTraceMetadataRoutes.test.ts \
  src/routes/__tests__/agentRoutesRbac.test.ts \
  src/routes/__tests__/traceProcessorProxyRoutes.test.ts
```

PR gate 中的固定入口：

```bash
cd backend && npm run test:core
npm run verify:pr
```
