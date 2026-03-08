---
scene: startup
priority: 2
effort: medium
keywords:
  - 启动
  - 冷启动
  - 热启动
  - 温启动
  - launch
  - startup
  - cold start
  - warm start
  - hot start
  - app start
  - 首帧
  - ttid
  - ttfd
  - first frame
compound_patterns:
  - "打开.*(应用|app|软件)"
  - "打开.*(速度|时间|耗时)"
---

#### 启动分析（用户提到 启动、冷启动、热启动、launch、startup）

**⚠️ 核心原则：**
1. **不能只报告"某 slice 耗时 XXms"——必须解释 WHY（为什么慢）**
2. **每个热点 slice 必须交叉分析**：结合四象限、线程状态（含 blocked_functions）、CPU 频率、Binder/IO/GC 数据，构建因果链
3. **四象限 + 线程状态是定位根因的核心工具**，不是独立罗列的数据
4. **使用 self_ms（exclusive time）做归因**：slice 数据包含 total_ms（wall time，含子 slice）和 self_ms（exclusive time，仅自身独占时间）。根因归因和优化收益估算必须基于 self_ms，避免父子 slice 重叠导致百分比超过 100%

**Phase 1 — 获取启动概览：**
```
invoke_skill("startup_analysis", { enable_startup_details: false })
```
返回：启动事件列表、延迟归因分析、主线程热点操作（含 self_dur_ms）、文件 IO、Binder 调用、**主线程状态分布（含 blocked_functions）**、GC 事件、数据质量检查、调度延迟。
从结果中提取 startup_id、start_ts、end_ts、dur_ms、package、startup_type 参数。

⚠️ **数据质量门禁特别注意：**
- **R008_TTID_GT_DUR**（TTID > 启动时长）：不要只说"TTID 不可信"。必须分析差值（TTID - dur_ms）去向——可能是 Activity 启动结束后仍有异步帧渲染、reportFullyDrawn 延迟、或 SurfaceFlinger 合成排队。建议在 Perfetto UI 中查看启动 end_ts 到 TTID 时间点之间的帧渲染情况。
- **R009_TYPE_RECLASSIFIED**（启动类型重分类）：如果温启动存在 bindApplication slice，说明进程实际被重建过，可能是冷启动被误分类。分析时应质疑启动类型并说明重分类依据。
- **温启动 + bindApplication 矛盾**：即使未触发 R009，如果主线程热点中出现 bindApplication（478ms+），也应主动质疑：温启动不应有 Application 初始化开销。可能原因：① 进程被回收后重启（实为冷启动）；② framework atrace 标记不准确。

**Phase 2 — 获取启动详情（需要传参）：**
```
invoke_skill("startup_detail", {
  startup_id: <从 Phase 1 获取>,
  start_ts: "<启动开始时间戳>",
  end_ts: "<启动结束时间戳>",
  dur_ms: <启动耗时ms>,
  package: "<包名>",
  startup_type: "<cold/warm/hot>"
})
```
返回：四象限分析（Q1-Q4）、CPU 大小核占比、CPU 频率统计、可操作热点 Top5（含 self_ms）、**主线程状态分布（含 blocked_functions）**、**热点 Slice 线程状态分布（per-slice 根因定位）**、Binder/IO/调度延迟详情。

**Phase 2.5 — 获取详细数据（必须执行，不可跳过）：**

invoke_skill 返回 artifact 摘要（仅含列名和行数）。**必须用 fetch_artifact 获取以下关键数据的完整行**，否则无法做根因分析：

| 必须获取的 artifact | 匹配 stepId / title 关键词 | 用途 |
|---|---|---|
| 主线程状态分布 | `main_thread_state` / "主线程状态" | **Q4 根因定位**：blocked_functions 列 |
| 四象限分析 | `quadrant_analysis` / "四大象限" | 确定时间花在 Q1/Q2/Q3/Q4 哪里 |
| CPU 频率 | `cpu_freq_analysis` / "CPU 频率" | 判断是否升频不足 |
| 可操作热点 | `actionable_main_thread_slices` / "可操作热点" | 确定优化目标（注意 self_ms 列） |
| **热点 Slice 线程状态** | `hot_slice_states` / "热点 Slice 线程状态" | **per-slice 根因定位（必须获取）**：每个热点 slice 内部的 Running/S/D 分布及 blocked_functions。这是判断 slice 慢在"计算"还是"阻塞"的唯一直接证据 |
| 主线程同步 Binder | `main_thread_sync_binder` / "同步 Binder" | Binder 阻塞量化 |
| GC 事件 | `gc_during_startup` / "GC" | GC 影响量化 |
| 主线程文件 IO | `main_thread_file_io` / "文件 IO" | IO 阻塞量化 |
| 调度延迟 | `sched_latency` / "调度延迟" | Q3 根因量化 |

获取方式（并行）：
```
fetch_artifact("art-N", detail="rows", offset=0, limit=50)  // 对每个关键 artifact
```
**在所有关键 artifact 数据到手之前，不要开始写结论。**

**Phase 3 — 综合结论（基于根因诊断决策树）：**

### 预检查：识别测试/模拟器应用

在开始根因分析前，检查热点 slice 名称是否包含测试/模拟特征词：
`LoadSimulator`、`ChaosTask`、`SimulateInflation`、`Benchmark`、`StressTest`、`TestRunner`、`FakeLoad`

如果检测到这些特征：
- 在**概览**中明确标注：**"⚠️ 此应用为性能测试/基准应用，slice 名称含有模拟负载标记"**
- 不要给出通用的"检查 synchronized 块"/"使用 AsyncLayoutInflater"等优化建议（对测试 App 无意义）
- 改为描述模拟负载的性能特征（如"ChaosTask 模拟了 70 次纯 CPU 计算"），帮助用户理解测试 App 的行为
- 如果用户的目标是验证测试框架本身，可以分析模拟负载是否符合预期

### Slice 嵌套感知（⚠️ 关键）

主线程热点 slice 数据包含两组指标：
- **total_ms / percent_of_startup**（wall time）：包含所有子 slice 的时间，**父子会重叠**
- **self_ms / self_percent**（exclusive time）：仅自身独占时间，**不含子 slice，不会重叠**

**必须遵循的规则：**
1. **根因归因用 self_ms**，不要用 total_ms。例如 `activityStart` 的 total_ms=832ms 但 self_ms 可能只有 5ms（其余全是子 slice 贡献），这意味着 activityStart 本身不是问题
2. **根因分析树中，嵌套 slice 必须体现父子关系**：
   - ✅ 正确：`activityStart (832ms wall) → performCreate (827ms) → LoadSimulator (710ms)`
   - ❌ 错误：将 activityStart (62%)、performCreate (61%)、LoadSimulator (53%) 作为独立根因并列
3. **优化建议的收益估算必须基于 self_ms**，不能把父子 slice 的 wall time 简单相加（会导致预期节省超过总时长）
4. **识别叶子 slice**：self_ms ≈ total_ms 的 slice 是叶子（无子 slice），是真正的耗时归因点；self_ms << total_ms 的 slice 是容器（框架包裹），优化价值低

### 启动阶段划分（必须覆盖）

Android 启动有两个串行大阶段，**分析结论必须覆盖两个阶段**，不能遗漏：

1. **bindApplication 阶段**（Application.onCreate / ContentProvider.onCreate）
   - 典型 slice：`bindApplication`、`app.onCreate`、`LoadSimulator_AppInit`
   - 冷启动特有；温启动出现 bindApplication 说明启动类型可能被误判

2. **activityStart 阶段**（Activity.onCreate / onStart / onResume → 首帧）
   - 典型 slice：`activityStart`、`performCreate:*`、`inflate`、`Choreographer#doFrame`

如果两个阶段的 self_ms 总和接近启动总时长，说明关键路径是串行的；如果远小于，说明有非主线程因素（如 Binder 阻塞、调度延迟）。

### 根因诊断决策树

**第一步：看四象限分布，确定主线程时间花在哪里**

| 四象限 | 占比 | 含义 | 下一步 |
|--------|------|------|--------|
| Q1 大核运行 高 | >50% | CPU-bound，主线程在大核执行计算 | → 分析热点 slice 的计算密集度 |
| Q2 小核运行 高 | >15% | 被调度到性能不足的小核 | → 检查进程优先级、是否有大核抢占、EAS/uclamp 配置 |
| Q3 Runnable 高 | >5% | CPU 资源争抢，可运行但得不到 CPU | → 看调度延迟数据、核迁移次数、后台负载 |
| Q4 Sleeping 高 | >25% | **主线程被阻塞**（最常见的根因来源） | → **必须看 blocked_functions 定位阻塞原因**（见第二步） |

**第二步：当 Q4 占比高时，用线程状态 + blocked_functions 定位阻塞根因**

主线程状态分布数据包含 state（Running/S/D/R）和 **blocked_functions** 列。这是最关键的诊断数据：

| 线程状态 | blocked_functions 特征 | 根因类型 | 典型场景 |
|---------|----------------------|---------|---------|
| S (Sleeping) | `futex_wait_queue` / `futex_wait` | **锁等待** | art_lock_contention、monitor 竞争、ReentrantLock、synchronized 块 |
| S (Sleeping) | `binder_wait_for_work` / `binder_ioctl` | **同步 Binder 阻塞** | 跨进程 IPC 等待 system_server 响应 |
| S (Sleeping) | `do_epoll_wait` / `ep_poll` | **Looper 空闲/等待事件** | 正常空闲（非问题）或等待异步回调 |
| S (Sleeping) | `pipe_wait` / `pipe_read` | **管道等待** | 等待子线程/进程通信 |
| S (Sleeping) | `SyS_nanosleep` / `hrtimer_nanosleep` | **主动 sleep** | 代码中的 Thread.sleep()/SystemClock.sleep() |
| S (Sleeping) | `do_wait` / `wait_consider_task` | **等待子进程** | fork 后等待 |
| D (Disk Sleep) | `io_schedule` / `blkdev_issue_flush` | **磁盘 IO** | 文件读写、数据库操作 |
| D (Disk Sleep) | `SyS_fsync` / `do_fsync` | **fsync 刷盘** | SQLite WAL checkpoint、SharedPreferences commit |
| D (Disk Sleep) | `filemap_fault` / `do_page_fault` | **页缺失** | 内存映射文件首次访问、dex 文件加载 |

**第 2.5 步：当主线程状态分布的 blocked_functions 为空或 "-" 时**

某些 trace 的 `blocked_functions` 列为空（内核未开启 CONFIG_SCHEDSTATS）。此时：

1. **优先使用 hot_slice_states 数据**（已包含在 startup_detail 的返回结果中，Phase 2.5 fetch_artifact 时获取）。
   即使全局 blocked_functions 为空，per-slice 的线程状态分布（Running/S/D 各自占比）仍然有效，可以判断 slice 慢在"计算"还是"阻塞"。

2. **从已有数据交叉推断**（hot_slice_states 的 blocked_functions 也为空时）：
   - S 状态时长高 + 主线程同步 Binder >50ms → **Binder 阻塞**是主因
   - S 状态时长高 + GC 在主线程 >20ms → **GC 阻塞**参与
   - D 状态时长高 + 文件 IO Top15 有大量 open/read → **磁盘 IO** 是主因
   - S 状态时长高 + 无明显 Binder/GC → 可能是 **锁等待** 或 **sleep()** 调用
   - **结论中必须标注"基于间接证据推断，blocked_functions 不可用"**

**第三步：用热点 Slice 线程状态（hot_slice_states）做 per-slice 根因定位**

`hot_slice_states` 返回每个热点 slice 内部的线程状态分解（Running/S/D/R 各自的耗时和 blocked_functions）。
**这是判断某个 slice 为什么慢的最直接证据**，优先于间接推理。

使用方式：
- 如果 `LoadSimulator_AppInit` 的 hot_slice_states 显示 S=400ms + blocked_functions=`futex_wait_queue`
  → **确证**：此 slice 被锁等待阻塞了 400ms
- 如果 `ChaosTask` 的 hot_slice_states 显示 Running=300ms + S=150ms + blocked_functions 为空
  → 结论：部分 CPU-bound + 部分阻塞，blocked_functions 为空则需结合上下文推断阻塞原因
- 如果 `SqliteLoad` 的 hot_slice_states 显示 D=30ms + blocked_functions=`io_schedule`
  → **确证**：主线程直接执行数据库查询产生磁盘 IO 阻塞

⚠️ **重要：slice 的 wall time ≠ 线程状态时间的直接对比**
slice 的 wall time（如 ChaosTask 479ms）包含 Running + S + D + R 所有状态。
不能直接用 slice wall time 与全区间的 S 状态总量做数值对比来推断因果关系。
必须用 `hot_slice_states` 的 per-slice 线程状态数据来确认具体比例。

如果 hot_slice_states 为空或不可用，才退回到间接推理（见第 2.5 步的补救措施），但**结论中必须标注"基于间接证据推断"**。

**第四步：检查 CPU 频率是否是瓶颈**
- 大核均频 vs 最高频率：如果均频远低于最高频 → 存在升频延迟或频率受限
- 冷启动初期 CPU 可能还在低频，影响前几百毫秒的性能
- 如果应用完全跑大核 (Q1≈100%) 且大核频率已达峰值 → 频率不是瓶颈，是纯计算量问题

⚠️ **CPU 频率估算**：参见"通用分析规则"中的 CPU 频率估算章节。启动场景特有注意：冷启动初期 CPU 可能还在低频，影响前几百毫秒的性能；thermal 限频可通过 thermal_zone 计数器确认。

**第五步：排除/确认其他影响因素**
- **Binder 阻塞**：看主线程同步 Binder 总时长。<10ms 基本可排除；>50ms 需关注具体接口
- **GC 影响**：看 GC 是否在主线程执行。Background GC 不直接阻塞主线程，但争抢 CPU。`GC: Wait For Completion` 在主线程上才真正阻塞
- **类加载**：冷启动时 `OpenDexFilesFromOat` 和类验证可能占显著时间
- **布局 Inflation**：`inflate` 和自定义 View 构造函数是 CPU-bound，看 Q1 而非 Q4
- **调度延迟**：>8ms 的严重延迟次数和最大值。频繁的调度延迟指向系统负载问题

**输出结构必须遵循：**

1. **概览**：应用名、启动类型、总耗时、评级、数据质量提示
   - 如果检测到模拟器/测试应用特征，必须在此标注
   - 如果启动类型与 bindApplication 存在矛盾，必须在此说明

2. **关键发现**（每个发现必须包含**根因推理链**，不能只报数字）：
   ```
   **[CRITICAL] 标题**
   - 描述：XX slice 自身耗时 YY ms（self_percent ZZ%）[wall time AA ms]
   - 根因推理链：
     ① 四象限显示 Q4=NN%（主线程大量时间被阻塞）
     ② 线程状态：S(Sleeping) = XX ms >> D(IO) = YY ms → 阻塞主因是 S 状态
     ③ blocked_functions 含 futex_wait_queue → 锁等待
     ④ 结合热点 slice：该 slice 内部存在 [锁竞争/sleep/同步Binder/IO阻塞]
   - 结论：此 slice 慢的根因是 [具体根因]，不是 [排除的因素]
   - 建议：[可操作的优化建议]
   ```

3. **根因分析树**：层级式展示启动耗时分解，**必须体现嵌套关系和使用 self_ms**
   ```
   启动总耗时 XXms
   ├── [Phase 1] bindApplication = XXms wall
   │     └── app.onCreate = XXms wall (self=YYms)
   │           ├── LoadSimulator_AppInit = XXms (self=YYms) ← 根因: [...]
   │           └── ChaosTask ×N = XXms (self=YYms) ← CPU-bound
   ├── [Phase 2] activityStart = XXms wall
   │     └── performCreate = XXms wall (self=YYms)
   │           ├── LoadSimulator_ActivityInit = XXms (self=YYms) ← 根因: [...]
   │           ├── SimulateInflation = XXms (self=YYms) ← CPU-bound
   │           └── ChaosTask ×N = XXms (self=YYms) ← CPU-bound
   └── [可排除因素]
         ├── Binder 阻塞 < Xms ✓
         ├── GC [主线程/后台线程] ✓
         └── 调度延迟 < Xms ✓
   ```
   ⚠️ 树中百分比用 self_percent，不要用 wall percent（否则总和超过 100%）

4. **优化建议**：按预期收益排列，标注优先级和预期收益
   - 收益估算基于 self_ms（不是 wall time）
   - 嵌套 slice 的收益不能简单相加

⚠️ **禁止的做法：**
- 只说"XX 耗时 YYms"但不解释为什么慢
- 把四象限、线程状态、Binder、GC 当独立章节罗列，而不进行交叉引用
- 忽略 blocked_functions 数据（这是定位 Q4 根因的关键）
- 在证据中只复制 slice 列表，不做根因推理链
- 把所有 Q4 时间统称为"休眠/阻塞"而不区分 S（锁/Binder/sleep）vs D（IO/页缺失）
- 不区分 GC 在主线程还是后台线程
- 把延迟归因（opinionated_breakdown）的 category 字段（IO/Layout/Other 等）当作真实的阻塞原因。这些 category 是 Perfetto 基于 slice 名称的**启发式分类**，不代表实际线程状态。例如 bind_application 被标记为 IO 类别，但实际阻塞原因可能是锁等待。**必须用线程状态数据（特别是 hot_slice_states）来验证真实根因**
- 用 slice wall time 与全区间线程状态总量做直接数值对比来推断因果（如"ChaosTask 479ms ≈ S状态 468ms 所以它是 S 状态的根因"）。wall time 包含所有线程状态，正确做法是使用 hot_slice_states 的 per-slice 状态分解
- **将嵌套 slice 的 wall time 作为独立根因并列报告**，导致百分比总和超过 100%。必须用 self_ms 归因
- **只分析 activityStart 阶段而遗漏 bindApplication 阶段**（反之亦然）。两个阶段都必须覆盖
- **给出过于精确的 CPU 频率收益估算**（如"升频可降低 28%"），除非有多频率对比的实测数据
