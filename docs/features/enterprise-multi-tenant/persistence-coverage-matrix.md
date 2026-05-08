# Enterprise Persistence Coverage Matrix

本文件记录 §0.6.7 的持久化测试覆盖证据。范围限定为 README §0.6.7 点名的 backend restart、queue shadow 恢复、DB reconnect、SecretStore failure 四类不变量。

## Scope

| §0.6.7 链路 | 自动证据 | 覆盖的不变量 |
| --- | --- | --- |
| backend restart | `backend/src/routes/__tests__/enterpriseRestartPersistence.test.ts`、`backend/src/agentv3/__tests__/claudeRuntimeRuntimeSnapshots.test.ts` | 清空 in-memory report/session/run state 后，trace metadata、report、recoverable session turns、Claude SDK session map 均可从 SQLite-backed durable state 恢复。 |
| queue shadow 恢复 | `backend/src/services/__tests__/analysisRunStore.test.ts`、`backend/src/routes/__tests__/enterpriseRestartPersistence.test.ts` | pending/running/awaiting_user analysis run 在 backend startup recovery 时统一转 failed，并保留 previousStatus；completed/quota_exceeded 等 terminal run 不被改写。 |
| DB reconnect | `backend/src/services/__tests__/enterpriseDb.test.ts`、`backend/src/services/__tests__/analysisRunStore.test.ts`、`backend/src/services/__tests__/agentEventStore.test.ts` | SQLite 以 WAL、foreign_keys、busy_timeout 打开；DB path 切换时 singleton store 重开到新 DB，不把旧 DB rows 写入新路径；事件/run store 均按当前 DB path 写入。 |
| runtime snapshots | `backend/src/services/__tests__/runtimeSnapshotStore.test.ts`、`backend/src/agentv3/__tests__/claudeRuntimeRuntimeSnapshots.test.ts` | `logs/claude_session_map.json` 替代物写入 `runtime_snapshots`；加载时只取最新非 stale entry；session cleanup 删除对应 snapshot rows。 |
| SecretStore failure | `backend/src/services/providerManager/__tests__/localSecretStore.test.ts`、`backend/src/services/providerManager/__tests__/enterpriseProviderStore.test.ts` | provider secrets 用 libsodium secretbox 加密且不进 provider metadata；legacy AES-GCM secret 可迁移；master key 错误时 fail closed，不返回错误密钥解出的明文；secret rotate/read 进入 audit。 |

## Verification

最小回归：

```bash
cd backend && npx jest --runInBand --forceExit \
  src/routes/__tests__/enterpriseRestartPersistence.test.ts \
  src/services/__tests__/analysisRunStore.test.ts \
  src/services/__tests__/enterpriseDb.test.ts \
  src/services/__tests__/agentEventStore.test.ts \
  src/services/__tests__/runtimeSnapshotStore.test.ts \
  src/agentv3/__tests__/claudeRuntimeRuntimeSnapshots.test.ts \
  src/services/providerManager/__tests__/localSecretStore.test.ts \
  src/services/providerManager/__tests__/enterpriseProviderStore.test.ts
```

PR gate 中的固定入口：

```bash
cd backend && npm run test:core
npm run verify:pr
```
