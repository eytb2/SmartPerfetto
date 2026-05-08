# Enterprise Integration Coverage Matrix

本文件记录 §0.6.2 的集成测试覆盖证据。范围限定为 README §0.6.2 点名的 HTTP 主链路：trace upload/list/delete/download、agent analyze/resume/respond/stream、report read/delete。

## Scope

| §0.6.2 链路 | 自动证据 | 覆盖的不变量 |
| --- | --- | --- |
| trace upload / list / read / download | `backend/src/routes/__tests__/enterpriseTraceMetadataRoutes.test.ts` | 上传进入 `data/{tenantId}/{workspaceId}/traces/`，元数据写入 `trace_assets`，列表和单条读取按 RequestContext scope 过滤，`GET /api/traces/:id/file` 返回 scoped trace 文件。 |
| trace delete | `backend/src/routes/__tests__/enterpriseTraceMetadataRoutes.test.ts` | active run、active lease、report holder 会阻断删除；释放 holder 后删除 trace 文件、`trace_assets` 元数据和审计事件。 |
| agent analyze | `backend/src/routes/__tests__/agentRoutesRbac.test.ts` | 分析请求要求 `agent:run`，会验证 scoped trace、lease draining、full analysis isolated lease，并落 `analysis_runs` 生命周期。 |
| agent resume / respond | `backend/src/routes/__tests__/agentRoutesRbac.test.ts` | `POST /api/agent/v1/resume` 只恢复当前 workspace 可读的 persisted session 与 trace；恢复后的 live session 可通过 `POST /api/agent/v1/:sessionId/respond` 执行授权动作。 |
| agent stream | `backend/src/routes/__tests__/agentRoutesRbac.test.ts`、`backend/src/assistant/stream/__tests__/sessionSseReplay.test.ts` | `Last-Event-ID` 后的 persisted terminal event 优先 replay，返回 `analysis_completed` 与 report URL；cursor 解析优先 header。 |
| report read / export / delete | `backend/src/routes/__tests__/enterpriseReportRoutes.test.ts` | report 写入 `report_artifacts` 与 scoped report 文件；read/export 可从 DB-backed storage 恢复；delete 清理 metadata 与文件并记录审计。 |
| restart recovery integration | `backend/src/routes/__tests__/enterpriseRestartPersistence.test.ts` | backend in-memory state 丢失后，trace metadata、report、session turns、interrupted analysis run 可从 durable storage 恢复或转 failed。 |

## Verification

最小回归：

```bash
cd backend && npx jest --runInBand --forceExit \
  src/routes/__tests__/enterpriseTraceMetadataRoutes.test.ts \
  src/routes/__tests__/agentRoutesRbac.test.ts \
  src/routes/__tests__/enterpriseReportRoutes.test.ts \
  src/routes/__tests__/enterpriseRestartPersistence.test.ts \
  src/assistant/stream/__tests__/sessionSseReplay.test.ts
```

PR gate 中的固定入口：

```bash
cd backend && npm run test:core
npm run verify:pr
```
