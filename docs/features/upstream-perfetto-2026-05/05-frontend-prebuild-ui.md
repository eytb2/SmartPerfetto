<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# 05. Frontend Prebuild、Vite 与 UI 资产守卫

## 目标

保证 upstream UI build/Vite/syntaqlite/runtime asset 改动不会破坏 SmartPerfetto
默认用户路径、Docker 路径和 portable release 路径。

## Upstream 变化

- UI build 迁移到 Vite/Rollup 相关产物。
- build 产出 `stdlib_docs.json`、`syntaqlite-runtime.*`、
  `syntaqlite-sqlite.wasm`、`syntaqlite-perfetto.wasm` 等 SQL 相关资产。
- QueryPage 和 public plugin API 新增 initial page plumbing。

## 现状

- `scripts/update-frontend.sh` 已能同步 versioned prebuild、保留 SmartPerfetto
  静态 assets、修正 manifest hash。
- 本轮同步后 committed prebuild 已对齐到 `frontend/v55.2-acd9f04a5`。
- 提交后 confidence loop 发现 formatter runtime 漏洞：upstream bundle 通过
  `assets/syntaqlite-*` 加载 formatter runtime，但之前 committed prebuild 只包含
  versioned root 下的 syntaqlite assets。现在 `scripts/update-frontend.sh` 会同步
  top-level `frontend/assets/syntaqlite-*`，并由 `scripts/check-frontend-prebuild.cjs`
  校验。

## 实施计划

1. Prebuild consistency checker。
   - 检查 `frontend/index.html` 中 stable version 与唯一 `frontend/v*` 目录一致。
   - 检查 manifest resources 都存在。
   - 检查 syntaqlite runtime assets 存在。
   - 检查 engine/traceconv bundle 不是 stub。
   - 状态：Done。

2. 脚本接入。
   - 将 checker 接入 `scripts/update-frontend.sh` 末尾。
   - 将 checker 接入 root quality 或 backend/package check，避免未来 stale bundle
     被提交。
   - 状态：Done，root `verify:pr` 已执行 `npm run check:frontend-prebuild`。

3. AI Assistant UI 接入。
   - SQL block 显示 formatted SQL。
   - 支持 copy formatted SQL。
   - 支持 “open in QueryPage” 或等价命令。
   - 如改插件源码，必须走 `start-dev.sh`、Perfetto UI typecheck/build、
     `update-frontend.sh`。

4. Initial page plumbing。
   - 评估是否让 SmartPerfetto trace 默认落到 AI Assistant/Trace Summary。
   - 先做 feature flag，避免改变用户对 Perfetto viewer 的默认预期。

## 测试

- `./scripts/update-frontend.sh`
- `node scripts/check-frontend-prebuild.cjs`
- `npm run check:frontend-prebuild`
- Perfetto UI typecheck/build。
- Browser smoke: `./start.sh` 默认路径能加载 committed frontend。
