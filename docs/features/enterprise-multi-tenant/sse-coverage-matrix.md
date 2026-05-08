# Enterprise SSE Coverage Matrix

本文件记录 §0.6.8 的 SSE 测试覆盖证据。范围限定为 README §0.6.8 点名的 fetch-stream reconnect、cursor replay、terminal event 落库三类不变量。

## Scope

| §0.6.8 链路 | 自动证据 | 覆盖的不变量 |
| --- | --- | --- |
| fetch-stream reconnect | `perfetto/ui/src/plugins/com.smartperfetto.AIAssistant/agent_sse_transport_unittest.ts`、`perfetto/ui/src/plugins/com.smartperfetto.AIAssistant/ai_panel.ts`、`perfetto/ui/src/plugins/com.smartperfetto.AIAssistant/ai_transient_state.ts` | 前端 stream URL 不把 cursor 放入 query；重连 cursor 通过 `Last-Event-ID` header 发送；fresh stream 不发送 cursor；transient restore 保留 `agentSessionId` 与 `lastEventId` 并以 resume 模式重新建立 fetch-stream。 |
| cursor parsing / replay | `backend/src/assistant/stream/__tests__/sessionSseReplay.test.ts`、`backend/src/assistant/stream/__tests__/streamProjector.contract.test.ts`、`backend/src/routes/__tests__/agentRoutesRbac.test.ts` | 服务端优先使用 `Last-Event-ID` header，legacy `lastEventId` query 仅作兼容 fallback；内存 ring buffer 只 replay cursor 之后的事件；路由层同时验证 header 优先级和 legacy query fallback。 |
| terminal event 落库 | `backend/src/services/__tests__/agentEventStore.test.ts`、`backend/src/routes/__tests__/agentRoutesRbac.test.ts`、`backend/src/routes/agentRoutes.ts` | `analysis_completed` / `error` 等 replayable SSE event 持久化到 `agent_events`；terminal event 持久化时同步更新 run/session terminal status；重连时先 replay DB event，命中 terminal 后结束 stream，不再落到 in-memory buffer。 |
| restart / persistence path | `backend/src/routes/__tests__/enterpriseRestartPersistence.test.ts`、`backend/src/scripts/__tests__/enterpriseRuntimeIsolationChecklist.test.ts` | backend restart 后仍可从 SQLite-backed durable state 恢复 terminal run/event；§11.11 checklist 固定 `sse-terminal-events-persisted` 反证项，避免 terminal reportUrl 只停留在进程内。 |

## Verification

最小回归：

```bash
cd backend && npx jest --runInBand --forceExit \
  src/assistant/stream/__tests__/sessionSseReplay.test.ts \
  src/assistant/stream/__tests__/streamProjector.contract.test.ts \
  src/services/__tests__/agentEventStore.test.ts \
  src/routes/__tests__/agentRoutesRbac.test.ts \
  src/routes/__tests__/enterpriseRestartPersistence.test.ts \
  src/scripts/__tests__/enterpriseRuntimeIsolationChecklist.test.ts
```

前端 fetch-stream cursor 单测入口：

```bash
cd perfetto/ui && ./run-unittests --no-build --test-filter "Agent SSE transport"
```

PR gate 中的固定入口：

```bash
cd backend && npm run test:core
cd backend && npm run test:scene-trace-regression
npm run verify:pr
```
