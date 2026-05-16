<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# Upstream Perfetto 2026-05 Integration Plan

本文把 2026-05-16 同步的 Google Perfetto upstream 功能拆成 SmartPerfetto
可落地的功能包。目标不是把官方 UI 功能逐项搬运，而是把能提升
SmartPerfetto 分析可靠性、SQL 正确性、Skill 覆盖和多 Trace 架构的部分
纳入现有产品边界。

执行 TODO 见 [TODO.md](TODO.md)。

## 功能包

| 顺序 | 功能包 | 计划文档 | 依赖关系 | 初始状态 |
|---|---|---|---|---|
| 1 | SQL guardrail 与格式化基础设施 | [01-sql-guardrails.md](01-sql-guardrails.md) | 无 | 已有 guardrail/injector，需增强 |
| 2 | stdlib docs、symbol index 与 lineage 校验 | [02-stdlib-lineage.md](02-stdlib-lineage.md) | 1 | 已有 symbol index，缺 lineage/函数宏 lint |
| 3 | Android 性能 Skill 升级 | [03-android-skill-upgrades.md](03-android-skill-upgrades.md) | 1、2 | 部分 Skill 已存在，需按 upstream stdlib 重整 |
| 4 | Trace Processor Connection/Database 映射 | [04-trace-processor-connection-model.md](04-trace-processor-connection-model.md) | 1 | 需要设计先行，不能直接改 pool |
| 5 | Frontend prebuild、Vite 与 UI 资产守卫 | [05-frontend-prebuild-ui.md](05-frontend-prebuild-ui.md) | 1、2、3 | prebuild 已同步，需补 guard |
| 6 | upstream AI skills 转译策略 | [06-upstream-ai-skills.md](06-upstream-ai-skills.md) | 2、3 | 只作为知识源，不直接引入 |
| 7 | 统一测试与 E2E 验收矩阵 | [07-verification-matrix.md](07-verification-matrix.md) | 全部 | 现有 gate 可复用，需补场景化命令 |

## 当前落地状态

- 2026-05-16 已完成功能包 1 的 M0 落地：新增共享 SQL stdlib dependency analyzer，
  raw SQL auto-include 和 Skill validator 已共用同一套 table/function/macro 依赖识别。
- 2026-05-16 已完成功能包 1 的 M1 落地：AI Assistant SQL 展示、复制和 pin
  使用最终可执行 SQL，并通过 upstream syntaqlite formatter 格式化。
- 2026-05-16 已完成功能包 2 的 M2 落地：新增
  `backend/data/perfettoSqlDocs.json`，由 upstream `stdlib_docs.json` 生成
  module/entity docs、direct/transitive includes 和可选 pfsql lineage 状态。
- 2026-05-16 已完成功能包 4 的 M3 落地：新增 trace processor
  database/connection/query provenance contract，`execute_sql_on`、`compare_skill`
  和 data SSE envelope 均显式标记 `traceSide`、`traceId` 与 processor key。
- validator 已能发现 stdlib function/macro 对应 module 的缺失声明；本轮据此补齐
  `surfaceflinger_module` 对 `android.frames.jank_type` 的依赖，并能把
  stdlib docs 的 transitive include 视为有效覆盖。
- SSE e2e harness 已补齐本地 trace metadata 写入，并允许 fast 模式保留确定性
  architecture detection 事件。
- dev 模式下 analysis result snapshot 写入已受 enterprise feature gate 控制，避免
  未持久化 run graph 时产生非阻断外键日志。
- 2026-05-16 已完成功能包 3 的 M4 落地：新增/升级 heap graph、bitmap heap
  metadata fallback、critical blocking thread-role provenance、AndroidLockContention
  owner-thread provenance、ChromeScrollJank v3/v4/frame timeline Skill。
- 2026-05-16 已完成功能包 6 的 M5 落地：新增 upstream AI skill translation SOP，
  并把 heap-dump/querying/ChromeScrollJank runbook 知识转成 YAML Skill 与 strategy
  入口。
- 2026-05-16 已补齐提交后 confidence loop：committed frontend 现在包含
  syntaqlite formatter 运行时所需的 top-level `assets/syntaqlite-*`，并新增
  `check:frontend-prebuild` 守卫，防止 formatter asset、manifest hash 或
  versioned prebuild 漂移再次静默进入 `main`。
- 已提交并 push 到 `origin/main`。

## 阶段 TODO

| 阶段 | 范围 | 状态 |
|---|---|---|
| M0 | SQL stdlib dependency analyzer、auto include、Skill validator | Done |
| M1 | syntaqlite SQL formatting、AI SQL 展示/复制、最终可执行 SQL metadata | Done |
| M2 | `stdlib_docs.json` + pfsql lineage 接入 SQL 知识基座 | Done |
| M3 | Trace Processor Connection/Database split 与 trace lease/pool 映射 | Done |
| M4 | Heap/lock/jank/startup 等 upstream 功能产品化 | Done |
| M5 | upstream AI skills 查询和判断标准转译 | Done |
| M6 | 提交后 confidence loop 与 prebuild asset 守卫 | Done |

## 实施顺序

1. 先做 SQL 依赖识别和 guardrail 增强，保证 raw SQL、Skill SQL、AI 输出 SQL
   使用同一套 stdlib/module 认知。
2. 再接 stdlib docs 与 lineage，让 Skill validator 能发现缺失 include、函数和
   macro 依赖，而不只检查 `FROM/JOIN` 表。
3. 显式化 trace processor connection/database/query provenance，保证
   multi-trace comparison 不把 current/reference 结果混成隐式共享状态。
4. 然后升级 Android 性能 Skill，把 upstream 新 stdlib 能力转化成
   SmartPerfetto 的 evidence layer。
5. 最后处理 UI 产品化和 upstream AI skills 转译。这两块影响面更大，需要在
   前置 SQL/trace contract 稳定后再改。

## 验收原则

- Prompt 不硬编码到 TypeScript；分析知识进入 `backend/strategies/`、
  `backend/skills/`、SQL package 或显式文档。
- SQL 规则必须同时覆盖 `execute_sql`、`execute_sql_on`、Skill validator 和
  report/evidence 输出。
- Skill 变更必须通过 `validate:skills` 和 canonical scene regression。
- 前端插件改动必须刷新 committed `frontend/` prebuild，并验证 manifest hash。
- 每个功能包都要有 focused unit test、集成验证和至少一个 E2E 或 scene
  regression 入口。

## 100% Confidence 边界

这里的 100% 只按工程验收定义：当前仓库、当前 bundled Trace Processor、
当前 committed frontend prebuild、当前测试 trace 和 `verify:pr` 能覆盖的 contract
必须闭环。它不等于证明所有未来 Perfetto SQL 语法、所有 upstream stdlib 变化、
所有真实用户 trace 都已被静态覆盖。

已闭环：

- SQL stdlib dependency、auto include、Skill validator、strict/audit/fail
  guardrail mode。
- AI SQL 展示/复制使用最终 SQL；formatter runtime 资产现在由
  `check:frontend-prebuild` 强制校验。
- stdlib docs/include closure、query provenance、M4/M5 Skill 输出 contract。

仍是明确边界：

- 完整 Perfetto SQL 语法证明需要真正的 SQL/Perfetto AST parser。
- `pfsql` binary 不可用时，没有 symbol-level lineage，只使用 stdlib docs include
  closure fallback。
- cross-connection `xConnect` 和 browser multi-window comparison 是后续独立产品化
  范围，不属于本轮默认路径的 100% claim。
