# Enterprise Runtime Coverage Matrix

本文件记录 §0.6.6 的运行时测试覆盖证据。范围限定为 README §0.6.6 点名的 lease acquire、release、heartbeat、stale、crash recovery 五类不变量。

## Scope

| §0.6.6 链路 | 自动证据 | 覆盖的不变量 |
| --- | --- | --- |
| lease acquire | `backend/src/services/__tests__/traceProcessorLeaseStore.test.ts`、`backend/src/routes/__tests__/agentRoutesRbac.test.ts` | 四类 holder 可进入同一 scoped lease；shared lease 复用、isolated lease 独立；full analysis 选择 isolated lease 并持久化 run heartbeat。 |
| release / drain | `backend/src/services/__tests__/traceProcessorLeaseStore.test.ts`、`backend/src/routes/__tests__/traceProcessorProxyRoutes.test.ts`、`backend/src/routes/__tests__/enterpriseTraceMetadataRoutes.test.ts` | release 后 active lease 进入 idle；draining lease 拒绝新 holder 和 proxy work；active run、active lease、report holder 会阻断 trace delete/cleanup。 |
| heartbeat | `backend/src/services/__tests__/traceProcessorLeaseStore.test.ts`、`backend/src/routes/__tests__/traceProcessorProxyRoutes.test.ts` | 同一 holder 续心跳只刷新 TTL，不重复 holder；frontend heartbeat 按 visible/hidden/offline TTL 更新；holder 消失后 heartbeat 可重新 acquire frontend holder。 |
| stale cleanup | `backend/src/services/__tests__/traceProcessorLeaseStore.test.ts`、`backend/src/services/__tests__/traceProcessorLeaseModeDecision.test.ts` | 过期 holder 会被 sweep；active lease 在 holder TTL 过期后转 idle；holderless 且 idle TTL 过期的 lease 转 released；过期 frontend lease 不会被当成可共享目标。 |
| crash recovery | `backend/src/services/__tests__/traceProcessorLeaseProcessorRouting.test.ts`、`backend/src/routes/__tests__/traceProcessorProxyRoutes.test.ts`、`backend/src/scripts/__tests__/enterpriseRuntimeIsolationChecklist.test.ts` | processor crash 后同一 lease 只有一个 supervisor restart；restart 保持 leaseId 稳定；1s/5s/15s backoff 全失败后 lease 标记 failed；管理员可显式 restart scoped lease。 |
| runtime observability | `backend/src/routes/__tests__/enterpriseRuntimeDashboardRoutes.test.ts`、`backend/src/scripts/__tests__/enterpriseRuntimeIsolationChecklist.test.ts` | runtime admin dashboard 暴露 active leases、holder type、RSS、queue length、events、LLM cost；§11.11 runtime isolation checklist 与 README、证据文件保持同步。 |

## Verification

最小回归：

```bash
cd backend && npx jest --runInBand --forceExit \
  src/services/__tests__/traceProcessorLeaseStore.test.ts \
  src/services/__tests__/traceProcessorLeaseModeDecision.test.ts \
  src/services/__tests__/traceProcessorLeaseProcessorRouting.test.ts \
  src/routes/__tests__/traceProcessorProxyRoutes.test.ts \
  src/routes/__tests__/agentRoutesRbac.test.ts \
  src/routes/__tests__/enterpriseTraceMetadataRoutes.test.ts \
  src/routes/__tests__/enterpriseRuntimeDashboardRoutes.test.ts \
  src/scripts/__tests__/enterpriseRuntimeIsolationChecklist.test.ts
```

PR gate 中的固定入口：

```bash
cd backend && npm run test:core
npm run verify:pr
```
