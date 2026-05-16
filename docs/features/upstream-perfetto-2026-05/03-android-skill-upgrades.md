<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

# 03. Android 性能 Skill 升级

## 目标

把 upstream 新增或强化的 Android analysis capability 转成 SmartPerfetto 的
Skill evidence layer。优先顺序按当前产品价值排序：

1. heap bitmap metadata / Java heap dump。
2. critical blocking calls + RenderThread blocking calls。
3. Android lock contention UX/SQL。
4. Chrome/Android frame timeline and jank drill-down。
5. Memscope/live memory profiling。

## 功能 1: Bitmap / Heap Dump

### 计划

- 新增或升级 atomic Skill：
  - `android_bitmap_memory_per_process`
  - heap bitmap source/sender attribution。
  - bitmap width/height/density/storage type summary。
- 新增 `android_heap_graph_summary`：
  - heap graph availability。
  - sample/process orientation。
  - top retained classes by cumulative/retained size。
- 升级 composite `memory_analysis`：
  - 如果存在 heap graph + bitmap table，增加 bitmap section。
  - 如果 stdlib 缺失，优雅降级到已有 RSS/native heap 分析。

### 状态

- 已完成 `android_bitmap_memory_per_process` 升级。
- 已完成 `android_heap_graph_summary` 首批 upstream heap-dump workflow 转译。
- 当前 bundled `perfetto/out/ui/trace_processor_shell` 支持 heap graph stats/class
  summary，但不支持 `android.memory.heap_graph.bitmap`；bitmap heap metadata 路径
  已做 optional fallback，TP 升级后自动产出。

### 测试

- `npm --prefix backend run test -- tests/skill-eval/memory_analysis.eval.ts --runInBand`
- 有 heap graph fixture 时补专用 eval；无 fixture 时先使用 SQL validator + optional
  fixture skip。

## 功能 2: Critical Blocking Calls / RenderThread

### 计划

- 使用 upstream `android.critical_blocking_calls` 相关 stdlib 作为优先数据源。
- 更新 `frame_blocking_calls`、`jank_frame_detail`、`startup_slow_reasons`。
- 区分 MainThread、RenderThread、Binder thread 的 blocking attribution。
- 把 deterministic evidence 与 AI inference 分开。

### 状态

- 已完成 `frame_blocking_calls` runtime 输出：`thread_role` / `thread_name` /
  `blocking_call` / overlap duration。
- Skill runtime eval 已覆盖 process identity gate + RenderThread/MainThread/Binder
  provenance contract。

### 测试

- `npm --prefix backend run test -- tests/skill-eval/jank_frame_detail.eval.ts --runInBand`
- `npm --prefix backend run test -- tests/skill-eval/startup_slow_reasons.eval.ts --runInBand`
- scene regression 覆盖 startup + scrolling。

## 功能 3: Lock Contention

### 计划

- 对齐 upstream `com.android.AndroidLockContention` SQL 语义。
- 升级 `lock_contention_in_range` 和 `lock_contention_analysis`。
- 输出 owner thread、blocked thread、duration、callsite/function。
- 对没有 lock contention data 的 trace 返回明确 empty result。

### 状态

- 已完成 `lock_contention_in_range.owner_contentions`。
- 已完成 `lock_contention_analysis.owner_contention_events`。
- 输出 Monitor + ART Lock contention 的 source、blocked thread、owner thread、
  owner TID、owner thread state、owner blocked function 与 overlap duration。

### 测试

- `npm --prefix backend run test -- tests/skill-eval/anr_analysis.eval.ts --runInBand`
- `npm --prefix backend run test -- tests/skill-eval/global_trace_sanity_check.eval.ts --runInBand`

## 功能 4: Frame Timeline / Jank

### 计划

- 复用 upstream preferred frame timelines 的处理思路。
- 升级 `consumer_jank_detection`、`jank_frame_detail`、`scrolling_analysis`。
- 输出 frame timeline availability 和 fallback path。
- 对 Android app trace 与 Chrome trace 分别处理，避免把 Chrome plugin 假设硬塞给
  Android app 分析。

### 状态

- 已新增 `chrome_scroll_jank_frame_timeline`，覆盖 `chrome_scrolls` /
  `chrome_scroll_stats` / `chrome_scroll_jank_v4_results` /
  `chrome_scroll_jank_tags_v4` / preferred frame timeline availability。
- `scrolling.strategy.md` 已要求 Chrome/WebView 场景先走 Chrome skill；普通
  Android trace 返回 `no_chrome_scroll_data` 时不能误判为 Chrome scroll jank。

### 测试

- `npm --prefix backend run test:scene-trace-regression`
- `npm --prefix backend run verify:agent-sse-scrolling -- --trace ../test-traces/scroll-demo-customer-scroll.pftrace --query "分析滑动性能" --output test-output/e2e-scrolling.json --keep-session`

## 功能 5: Memscope

### 计划

- 短期不直接引入 live Memscope UI。
- 先提取可复用的 process memory category、RSS/swap/page cache/pressure 视角。
- 映射到 existing memory Skill 和 future enterprise live profiling 入口。

### 状态

- 本轮不引入 live Memscope UI。
- 已把 heap graph / bitmap / RSS 路径放入 memory strategy；Memscope 仍作为 future
  live profiling 产品线，不阻塞 M4。

### 测试

- `memory_analysis` 和 future live profiling smoke。
