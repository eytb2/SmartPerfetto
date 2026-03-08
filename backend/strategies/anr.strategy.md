---
scene: anr
priority: 1
effort: medium
keywords:
  - anr
  - 无响应
  - 应用无响应
  - 主线程无响应
  - deadlock
  - not responding
  - 死锁
  - watchdog
  - broadcast timeout
  - input dispatching
---

#### ANR 分析（用户提到 ANR、无响应、not responding）

本策略诊断应用无响应 (ANR) 事件的根因。ANR 表示主线程被阻塞 ≥5s（输入事件）或 ≥10s（广播/服务），
需要识别阻塞函数、锁争用、死锁或 CPU 饥饿。

**ANR 类型分类：**

| ANR 类型 | 超时阈值 | 触发条件 |
|----------|---------|---------|
| Input Dispatching | 5s | 输入事件分发无响应 |
| Broadcast Timeout | 10s (前台) / 60s (后台) | BroadcastReceiver.onReceive() 超时 |
| Service Timeout | 20s (前台) / 200s (后台) | Service.onCreate()/onStartCommand() 超时 |
| Content Provider | 10s | ContentProvider 发布超时 |
| Execution Timeout | 10s | Job/Alarm 执行超时 |

**Phase 1 — ANR 事件检测（1 次调用）：**
```
invoke_skill("anr_analysis")
```
获取 ANR 事件列表、类型、时间戳、涉及进程。

**Phase 2 — 根因分析（1 次调用）：**
```
invoke_skill("anr_detail")
```

**Phase 3 — 决策树（基于 ANR 类型和阻塞模式）：**

根据 anr_detail 返回的 `blocked_function` 和线程状态，按以下决策树判断根因：

1. **锁争用 (Lock Contention)**
   - 特征：`blocked_function` 包含 `monitor`、`lock`、`Mutex`、`synchronized`
   - 进一步分析：查找锁持有者线程 → 分析持有者在做什么
   - 常见模式：数据库锁、SharedPreferences commit、Binder 同步调用

2. **Binder 调用阻塞**
   - 特征：`blocked_function` 包含 `binder`、`transact`、`BinderProxy`
   - 进一步分析：`execute_sql` 查询 binder transactions 找到对端进程
   - 常见模式：系统服务慢响应、对端进程死锁

3. **IO 阻塞**
   - 特征：线程状态 `D` (Uninterruptible Sleep)、`blocked_function` 包含 `read`、`write`、`open`、`fdatasync`
   - 进一步分析：检查 IO 延迟、磁盘使用率
   - 常见模式：大文件 IO、数据库操作、日志写入

4. **CPU 饥饿 (CPU Starvation)**
   - 特征：主线程大量处于 `R` (Runnable) 但未执行
   - 进一步分析：`execute_sql` 查询 CPU 调度延迟、检查 CPU 频率
   - 常见模式：后台进程 CPU 密集、thermal throttling

5. **死锁 (Deadlock)**
   - 特征：两个或多个线程互相等待对方持有的锁
   - 进一步分析：分析锁依赖链
   - 常见模式：UI 线程 ↔ Worker 线程交叉锁

6. **主线程重负载**
   - 特征：主线程在 `Running` 状态但持续执行耗时操作
   - 进一步分析：检查主线程 slice 中的耗时函数
   - 常见模式：大量 View inflate、JSON 解析、图片解码

**Phase 4 — 综合输出：**

### 输出结构：
1. **ANR 概览**：类型、时间戳、涉及进程
2. **阻塞分析**：被阻塞的函数/线程、阻塞时长、线程状态分布
3. **根因判断**：基于决策树的根因分类 + 证据
4. **优化建议**：针对根因类型的具体修复方向
