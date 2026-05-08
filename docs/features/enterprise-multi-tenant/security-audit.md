# Enterprise Security Audit

本文件记录 §0.5.9 的安全审计闭环。审计范围只覆盖本轮明确要求的三类问题：ID 枚举、跨 tenant、无权限 provider/report/memory 访问。每行对应 `backend/src/scripts/enterpriseSecurityAuditChecklist.ts` 的稳定 ID，并由 Jest 校验 README、证据文件和本文档同步。

验证命令：

```bash
cd backend && npx jest --runInBand src/scripts/__tests__/enterpriseSecurityAuditChecklist.test.ts
```

| ID | 审计面 | 必须成立的不变量 | 自动证据 |
| --- | --- | --- | --- |
| `id-enumeration-trace-session-report` | ID 枚举 | 未知或越权 traceId/sessionId/runId/reportId 不能区分不存在与无权访问。 | `ownerGuardRoutes.test.ts` 覆盖跨 tenant trace、report、agent session report 404；enterprise trace/report route tests 覆盖跨 workspace 404。 |
| `cross-tenant-owner-guard` | 跨 tenant | 跨 tenant/workspace 的持久化引用、列表、资源路径和知识检索必须先按 scope 过滤。 | `enterpriseSchema.test.ts` 拒绝跨 tenant 外键链；`workspaceResourceRoutes.test.ts` 拒绝 SSO 选中 workspace 与路径不一致；`enterpriseKnowledgeScope.test.ts` 覆盖 RAG / baseline / memory / case scope 过滤。 |
| `provider-management-permission` | 无权限 provider 访问 | Provider 管理面必须要求 provider:manage_workspace，不允许 analyst/viewer 枚举或读取 provider 配置。 | `providerRoutes.ts` route guard 强制 `provider:manage_workspace`；`providerRoutes.test.ts` 覆盖 analyst SSO 请求 403，workspace_admin 可访问模板。 |
| `report-read-permission` | 无权限 report 访问 | 缺少 report:read 的同 workspace 请求也必须按 not found 处理，避免报告 ID 枚举。 | `rbac.ts` 的 `canReadReportResource` 同时检查 workspace 和 `report:read`；`ownerGuardRoutes.test.ts` 覆盖自定义无 report 权限角色读取 report export 返回 404。 |
| `memory-admin-permission` | 无权限 memory 访问 | Memory 检视、promotion、删除和审计面必须要求 audit:read。 | `memoryRoutes.ts` route guard 强制 `audit:read`；`memoryRoutes.test.ts` 覆盖 analyst SSO 对 list/audit/delete 返回 403，workspace_admin 可访问。 |
