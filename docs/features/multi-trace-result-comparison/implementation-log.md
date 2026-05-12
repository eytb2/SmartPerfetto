<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# 多 Trace 分析结果对比实施记录

本文记录 `README.md` 第 9 节 TODO 的逐项验收证据。

## M0.1 Submodule 与插件源码

状态：完成。

验收证据：

- `git submodule update --init perfetto` 成功，`perfetto` checkout 到 gitlink `f28da9c872b7997c8f60ba67660a0e44d0d433c0`。
- 插件源码存在于 `perfetto/ui/src/plugins/com.smartperfetto.AIAssistant/`。
- 源码中可定位现有对比入口：`ai_panel.ts` 的 `referenceTraceId`、`renderTracePicker()`、`enterComparisonMode()`、`switchComparisonTrace()`，以及 `comparison_state_manager.ts`。
- prebuild bundle `frontend/v54.0-0cf3beb39/frontend_bundle.js` 中可定位同一组 SmartPerfetto 插件线索：`referenceTraceId`、`comparison_state_manager`、`getSmartPerfettoWindowId`、`PENDING_BACKEND_TRACE_KEY`。

结论：

- 当前 worktree 具备插件源码，可以继续做前端改动。
- `frontend/` prebuild 与 submodule 内插件源码在关键功能线索上对齐；后续 UI 改动仍必须按规则通过 `./scripts/update-frontend.sh` 刷新 prebuild。
