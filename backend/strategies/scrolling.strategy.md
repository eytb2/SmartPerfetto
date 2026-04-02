---
scene: scrolling
priority: 3
effort: medium
required_capabilities:
  - frame_rendering
  - cpu_scheduling
optional_capabilities:
  - binder_ipc
  - surfaceflinger
  - gpu
  - thermal_throttling
  - input_latency
  - lock_contention
keywords:
  - 滑动
  - 卡顿
  - 掉帧
  - 丢帧
  - jank
  - scroll
  - fps
  - 帧
  - frame
  - 列表
  - 流畅
  - fling
  - swipe
  - 刷新
  - 滚动
  - recycler
  - listview
  - lazy
  - 快滑
  - 慢滑
  - stuttering
  - dropped frame
  - janky
  - 不流畅
  - surfaceflinger
  - impeller
---

#### 滑动/卡顿分析（用户提到 滑动、卡顿、掉帧、jank、scroll、fps）

**⚠️ 核心原则：**
1. **逐帧根因诊断是最重要的**。概览统计（帧率、卡顿率）只是入口，真正有价值的是每一个掉帧帧的根因分析。
2. **Per-Layer Buffer 枯竭检测（token-gap 模型）**：
   - 掉帧检测基于 `display_frame_token` 序列缺口：当 App Layer 在连续 SF DisplayFrame 中出现 token 跳跃（gap > 1），说明 SF 在中间帧合成时该 Layer 没有新 Buffer = 缓冲区枯竭 = 用户可见卡顿
   - `token_gap = 1` → 正常（每帧都有新 buffer），`token_gap = N` → 跳过 N-1 个 DisplayFrame
   - 这是 per-layer 检测，不受 SF 全局合成状态影响（SF 可能在消费其他 Layer 的 buffer）
3. **Guilty Frame 溯源**：
   - BlastBufferQueue 三缓冲下，可见卡顿通常出现在慢帧 2-3 帧之后（管线排空）
   - `guilty_frame_id` 字段指向导致管线枯竭的实际慢帧（向前回溯 ≤5 帧，取最慢的超预算帧）
   - 根因分析（四象限/CPU/Binder）应针对 guilty frame 而非枯竭帧本身
4. **get_app_jank_frames 结果中的 `jank_responsibility` 字段**：
   - `APP`：App 侧原因（App Deadline Missed / Self Jank）
   - `SF`：SurfaceFlinger 侧原因
   - `HIDDEN`：缓冲区枯竭但框架未标记（Perfetto 帧颜色为绿色）
   - `BUFFER_STUFFING`：Buffer Stuffing

**Phase 1 — 概览 + 掉帧列表 + 批量根因分类（1 次调用）：**
```
invoke_skill("scrolling_analysis", { start_ts: "<trace_start>", end_ts: "<trace_end>", process_name: "<包名>" })
```
- 建议传入 start_ts 和 end_ts 以获得更精确的结果
- 如果不知道 trace 时间范围，先用 SQL 查询：
  `SELECT printf('%d', MIN(ts)) as start_ts, printf('%d', MAX(ts + dur)) as end_ts FROM actual_frame_timeline_slice`
- 返回结果以 artifact 引用形式返回（紧凑摘要），包含：
  - `jank_type_stats`：掉帧类型分布，**注意 real_jank_count（真实掉帧）vs false_positive（假阳性）**
  - `scroll_sessions`：滑动区间列表
  - `batch_frame_root_cause`（主掉帧列表）：所有掉帧帧的**完整分析**（frame_id + start_ts + jank_type + jank_responsibility + vsync_missed + reason_code + 四象限 MainThread/RenderThread + CPU 频率 + Binder/GC 重叠 + 根因分类），覆盖所有掉帧帧
  - `get_app_jank_frames`（内部数据源，无独立显示）：掉帧帧列表，供 Agent 内部使用（焦点区间、帧实体捕获）
  - `scroll_sessions` 可展开：点击展开某个滑动区间，可查看该区间的**四象限分布、CPU 频率、关键线程大小核分布**（由 `session_stats_batch` 提供）
  - `session_quadrant_summary`（兼容数据源，不独立显示）：**滑动过程整体**四象限分布，Agent 可通过 save_as 引用
  - `session_cpu_freq`（兼容数据源，不独立显示）：CPU 频率分布
  - `session_thread_core_affinity`（兼容数据源，不独立显示）：关键线程大小核分布
- **获取详细数据**：对大型 artifact 使用分页获取：
  `fetch_artifact(artifactId, detail="rows", offset=0, limit=50)`
  响应包含 `totalRows` 和 `hasMore`，继续翻页获取所有数据。
  **必须获取完所有相关数据再出结论**，不可只看前 50 行就下结论

**Phase 1.5 — 架构感知分支（基于 detect_architecture 结果）：**

| 架构 | 调整动作 |
|------|---------|
| **Flutter** | 改用 `invoke_skill("flutter_scrolling_analysis")` 代替 `scrolling_analysis`。Flutter 的 1.ui/1.raster 线程模型与标准 RenderThread 不同，jank 帧的根因归属逻辑也不同 |
| **WebView** | 使用标准 `scrolling_analysis`，但注意 CrRendererMain 线程的 slice 可能是卡顿主因。WebView 场景下，CrRendererMain 线程的阻塞（V8 GC、CSS Layout Thrashing）可能导致帧延迟。可调用 webview_v8_analysis Skill 检查 V8 性能 |
| **标准 HWUI** | 使用标准 `scrolling_analysis` |
| **Compose** | 使用标准 `scrolling_analysis`。如果检测到 Compose 架构，注意 Recomposition* slices 可能是卡顿主因。LazyColumn/LazyRow 的 prefetch 和 compose 阶段如果超时会导致掉帧。可调用 compose_recomposition_hotspot Skill 检测过度重组 |

**Phase 1.7 — 根因分支深钻（基于 batch_frame_root_cause 的 reason_code 和 jank_responsibility）：**

| 条件 | 深钻动作 |
|------|---------|
| **多帧 `reason_code = gpu_bound`** | 调用 `invoke_skill("gpu_analysis")` 或 `execute_sql` 查询 GPU 频率/利用率。GPU 瓶颈通常与 GPU 频率受限或 shader 复杂度有关 |
| **多帧 `jank_responsibility = SF`** | 调用 `invoke_skill("surfaceflinger_analysis")` 分析 SF 合成延迟、GPU/HWC 合成比例、Fence 超时 |
| **多帧 `big_avg_freq_mhz` 显著低于设备峰值** | 调用 `invoke_skill("thermal_throttling")` 检查是否存在热节流。CPU 频率被 thermal 限制是常见的跨帧系统级根因 |
| **VRR 设备（通过 `vrr_detection` 或 VSync 周期 ≠ 16.67ms 判断）** | 注意 1.5x VSync 阈值需基于检测到的实际 VSync 周期（如 120Hz = 8.33ms, 1.5x = 12.5ms），而非固定 16.67ms |

**Phase 1.9 — 根因深钻（🔴 强制执行，不可跳过）：**

对 `batch_frame_root_cause` 中占比 >15% 的每个 reason_code，**必须**选最严重的 1 帧执行深钻。
**⛔ 禁止**仅靠 batch_frame_root_cause 的统计分类直接出结论——reason_code（如 workload_heavy）只是分类标签，不是真正的根因。
**必须**通过至少一次工具调用（blocking_chain_analysis / binder_root_cause / lookup_knowledge / jank_frame_detail）获取机制级证据，回答"WHY 这帧慢"。跳过此步骤将触发验证错误。

**常见错误：** 看到 reason_code=workload_heavy 就结论"工作负载过重"，但没有回答：具体是哪段代码？为什么在这个时机执行？是否可异步/分帧？这不是根因分析，这只是分类。

| 条件 | 深钻动作 | 目标 |
|------|---------|------|
| **任何 reason_code + Q4>20%** | `invoke_skill("blocking_chain_analysis", {start_ts, end_ts, process_name})` | 阻塞链：谁阻塞了主线程？是锁？Binder？IO？唤醒者是谁？ |
| **binder_overlap >5ms** | `invoke_skill("binder_root_cause", {start_ts, end_ts, process_name})` | 服务端还是客户端慢？具体原因（GC？锁？IO？内存回收？）|
| **gc_overlap >3ms** | 查询 `android_garbage_collection_events` WHERE gc_ts 在帧窗口内 | 哪种 GC？回收了多少？GC 运行耗时？|
| **freq_ramp_slow** | `lookup_knowledge("cpu-scheduler")` | 是 governor 升频延迟还是 thermal 限频？|
| **small_core_placement** | `lookup_knowledge("cpu-scheduler")` | 为什么被调度到小核？大核被谁占用？|
| **gpu_bound** | `lookup_knowledge("rendering-pipeline")` | GPU 频率是否被限？SF 合成是否是瓶颈？|

**WHY 链深度要求：** 每个 [CRITICAL]/[HIGH] 发现的根因推理链必须至少 2 级：
- ✅ Level 1: "帧超时" → Level 2: "Binder 阻塞" → Level 3: "服务端 system_server monitor_contention"
- ❌ 仅 Level 1: "帧超时 45ms，workload_heavy"（缺少机制解释）

**Phase 2 — 补充深钻（可选，仅在 Phase 1.9 深钻后仍需更多细节时执行）：**
Phase 1 的 `batch_frame_root_cause` 已包含每帧的**完整统计数据**（但统计数据 ≠ 根因，Phase 1.9 的工具调用深钻不可省略）：
- MainThread 四象限（Q1 大核运行 / Q2 小核运行 / Q3 调度等待 / Q4 休眠）
- RenderThread 四象限（render_q1 大核 / render_q3 调度 / render_q4 休眠）
- CPU 大核频率（big_avg_freq_mhz / big_max_freq_mhz）+ 升频延迟（ramp_ms）
- Binder 同步重叠（binder_overlap_ms）+ GC 重叠（gc_overlap_ms）
- 根因分类（reason_code）+ 关键操作（top_slice_name / top_slice_ms）

此外，每个滑动区间的**整体运行特征**（四象限分布、CPU 频率、关键线程大小核分布）已内嵌在 `scroll_sessions` 的展开行中（由 `session_stats_batch` 提供），无需调用 jank_frame_detail 或 blocking_chain_analysis 来获取全局指标。兼容数据源 `session_quadrant_summary`、`session_cpu_freq`、`session_thread_core_affinity` 仍可通过 save_as 引用。

**batch_frame_root_cause 的统计数据可用于分类和概览，但 Phase 1.9 的深钻工具调用不可省略**。jank_frame_detail 仅在以下特殊情况需要调用：
仅在以下情况才调用 jank_frame_detail（**最多 2 帧**）：
- 需要查看 CPU 频率**时间线**（帧内频率变化过程）
- 需要查看 RenderThread 或主线程的 top N slices 详情
- **reason_code 为 unknown 且帧数 >5%**：必须对至少 1 帧调用 jank_frame_detail 获取更多线索，不能在分布表中仅标记"未分类"就跳过
- reason_code 与实际数据矛盾时（如 `lock_binder_wait` 但 Binder 耗时 0ms）：应在结论中标注可能的误分类原因

```
invoke_skill("jank_frame_detail", {
  start_ts: "<帧的start_ts>",
  end_ts: "<帧的end_ts>",
  jank_type: "<帧的jank_type>",
  jank_responsibility: "<帧的jank_responsibility>",
  process_name: "<包名>"
})
```

**Phase 3 — 综合结论（基于全量帧数据）：**

**输出结构必须遵循：**

1. **概览**（必须包含以下数据）：
   - 总帧数、**总真实掉帧数 = SUM(所有 jank_type 行的 real_jank_count)**
   - 分类明细：App 侧掉帧 N 帧 + 隐形掉帧 N 帧 + 假阳性 N 帧
   - **峰值体验指标**（仅看掉帧率会掩盖极端长帧对用户感知的影响）：
     - 最长帧耗时：XXms（超预算 N 倍）
     - 最长连续丢帧 VSync 数：N 个 VSync（= XXms 无响应）
     - 如有 >3 帧超过 3× VSync 预算，标注"存在用户强感知卡顿峰值"
   - **综合评级标准**（不能只看掉帧率，必须同时考虑峰值）：
     - 优秀：掉帧率 <1% 且最长帧 <2× VSync
     - 良好：掉帧率 <3% 且最长帧 <4× VSync
     - 一般：掉帧率 <5% 或最长帧 <8× VSync
     - 差：掉帧率 ≥5% 或最长帧 ≥8× VSync
     - 例：掉帧率 2% 但最长帧 62ms（7.5× VSync）→ 评级应为"一般"而非"良好"
   - **指标口径说明**：FPS 基于滑动时间窗口（非分析耗时），时间范围需标注来源
   - 如果存在隐形掉帧（`jank_type=None` 但 `real_jank_count > 0`），**必须在概览中明确标注**：
     "其中 N 帧为隐形掉帧（框架未标记但消费端检测到真实掉帧），可能与 SurfaceFlinger 合成延迟、管线积压或跨进程 Binder 阻塞有关"
   - ⚠️ **`App Deadline Missed` 不等于全部真实掉帧**。例如 135 帧 App Deadline Missed + 165 帧隐形掉帧 = 300 总真实掉帧

2. **各滑动区间运行特征**（from scroll_sessions 展开行，或兼容数据源 session_quadrant_summary / session_cpu_freq / session_thread_core_affinity）：
   - 对每个滑动区间分别报告（如有多个区间，逐区间列出）：
   - 主线程四象限：Q1=XX% Q2=XX% Q3=XX% Q4a=XX% Q4b=XX%
   - RenderThread 四象限：Q1=XX% Q3=XX% Q4a=XX% Q4b=XX%
   - CPU 频率：prime 均频 XXMHz / big 均频 XXMHz / little 均频 XXMHz
   - 关键线程大小核分布：MainThread prime XX%+big XX% / RenderThread prime XX%+big XX%

3. **全帧根因分布**（基于 batch_frame_root_cause，覆盖所有掉帧帧）：
   按 reason_code 聚合，附带四象限分布和频率特征：
   ```
   | 根因类型 | 帧数 | 占比 | 四象限特征 | 频率特征 |
   |---------|------|------|-----------|---------|
   | workload_heavy | 80 | 59% | Q1=45% Q3=8% | 大核均频 2200MHz |
   | freq_ramp_slow | 30 | 22% | Q1=30% Q3=12% | 大核均频 1100MHz, ramp>10ms |
   | small_core_placement | 15 | 11% | Q2=55% | 大核均频 900MHz |
   | ... | ... | ... | ... | ... |
   ```

4. **代表帧分析**（每个根因类别选最严重的 1 帧，从 batch 数据中直接引用）：
   ```
   ### [reason_code] 代表帧: [start_ts] — [jank_responsibility]
   - 帧耗时：XXms（帧预算 XXms）
   - 主线程：Q1=XX% Q2=XX% Q3=XX% Q4=XX%
   - RenderThread：Q1=XX% Q3=XX% Q4=XX%
   - 关键操作：[top_slice_name] 耗时 XXms
   - CPU 频率：均频 XXMHz / 峰频 XXMHz，升频延迟 XXms
   - Binder: XXms / GC: XXms
   ```
   如有额外深钻帧（来自 jank_frame_detail），标注其 CPU freq timeline 和 slices 详情。

5. **优化建议**：按根因类别给出可操作建议，优先级按帧数占比排序。**必须分层标注**：
   - **[App 层]**：App 开发者可直接实施的优化（异步化、分帧、预加载、减少主线程阻塞等）— 建议要具体到代码模式
   - **[系统/ROM 层]**：需要厂商协同或系统级权限的优化（governor 调优、thermal 策略、SCHED_UTIL_CLAMP 等）— 标注"需系统级能力"
   - 优先给出 App 层建议；系统层建议仅作为补充参考

**当报告隐形掉帧时，必须提醒用户：**
- 隐形掉帧在 Perfetto 时间线上帧颜色为**绿色**（框架标记 jank_type=None）
- 真实卡顿证据是 **VSYNC-sf 计数器轨道**上的呈现间隔异常（> 1.5x VSync 周期）
- 可参考帧列表中的"呈现间隔"列确认

⚠️ **结论必须覆盖所有掉帧帧的根因分布**，不能只报告少数几帧。
   batch_frame_root_cause 提供了全量分类和详细指标，结论中的"全帧根因分布"和"代表帧分析"都应基于它。

---

#### 滑动场景关键 Stdlib 表

写 execute_sql 时优先使用（完整列表见方法论模板）：`android_frame_stats`、`android_frames_overrun`、`android_surfaceflinger_workloads`、`android_gpu_frequency`、`cpu_thread_utilization_in_interval(ts, dur)`、`cpu_frequency_counters`、`slice_self_dur`、`android_screen_state`

---

#### 滑动分析的 SQL 回退方案

**当 scrolling_analysis Skill 返回 success=false 或 get_app_jank_frames 为空时**，按以下步骤走：

**回退 Step 1 — 消费端真实掉帧检测（含隐形掉帧）：**

```sql
WITH vsync_intervals AS (
  SELECT c.ts - LAG(c.ts) OVER (ORDER BY c.ts) as interval_ns
  FROM counter c JOIN counter_track t ON c.track_id = t.id
  WHERE t.name = 'VSYNC-sf'
),
vsync_cfg AS (
  SELECT COALESCE(
    (SELECT CAST(PERCENTILE(interval_ns, 0.5) AS INTEGER)
     FROM vsync_intervals
     WHERE interval_ns BETWEEN 4000000 AND 50000000),
    16666667
  ) as period_ns
),
frames AS (
  SELECT a.ts, a.dur, a.jank_type,
    a.ts + CASE WHEN a.dur > 0 THEN a.dur ELSE 0 END as present_ts,
    LAG(a.ts + CASE WHEN a.dur > 0 THEN a.dur ELSE 0 END)
      OVER (PARTITION BY a.layer_name ORDER BY a.ts) as prev_present_ts
  FROM actual_frame_timeline_slice a
  LEFT JOIN process p ON a.upid = p.upid
  WHERE (p.name GLOB '{process_name}*' OR '{process_name}' = '')
    AND p.name NOT LIKE '/system/%'
)
SELECT printf('%d', ts) AS start_ts, printf('%d', ts + dur) AS end_ts,
  ROUND(dur/1e6, 2) AS dur_ms, jank_type,
  CASE WHEN jank_type = 'None' OR jank_type IS NULL THEN '隐形掉帧' ELSE jank_type END as display_type,
  CASE
    WHEN jank_type = 'None' OR jank_type IS NULL THEN 'HIDDEN'
    WHEN jank_type GLOB '*SurfaceFlinger*' THEN 'SF'
    ELSE 'APP'
  END as responsibility,
  MAX(CAST(ROUND((present_ts - prev_present_ts) * 1.0 / (SELECT period_ns FROM vsync_cfg) - 1, 0) AS INTEGER), 0) as vsync_missed
FROM frames
WHERE prev_present_ts IS NOT NULL
  AND (present_ts - prev_present_ts) <= (SELECT period_ns FROM vsync_cfg) * 6
  AND (present_ts - prev_present_ts) > (SELECT period_ns FROM vsync_cfg) * 1.5
ORDER BY vsync_missed DESC, dur DESC
LIMIT 20
```

⚠️ 注意：此 SQL 同时返回框架标记的掉帧和隐形掉帧。`display_type='隐形掉帧'` 的帧是框架未标记但消费端检测到的真实掉帧。

**回退 Step 2 — 对 top 5 卡顿帧调用 jank_frame_detail（必须执行）：**
- 混合选取 APP 和 HIDDEN 帧
```
invoke_skill("jank_frame_detail", { start_ts: "<帧的start_ts>", end_ts: "<帧的end_ts>", process_name: "<包名>" })
```

**不执行逐帧分析就直接出结论是不允许的。**
