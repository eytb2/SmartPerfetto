# SmartPerfetto Skills 开发指南

## 目录结构

```
skills/
├── base/                    # 基础 Skills (所有设备通用)
│   ├── startup.skill.yaml   # 启动分析 Skill
│   ├── startup.sop.md       # 启动分析 SOP 文档
│   ├── scrolling.skill.yaml # 滑动卡顿分析
│   ├── scrolling.sop.md
│   ├── click_response.skill.yaml  # 点击响应分析
│   ├── navigation.skill.yaml      # 界面跳转分析
│   ├── memory.skill.yaml          # 内存分析
│   ├── cpu.skill.yaml             # CPU 分析
│   ├── binder.skill.yaml          # Binder IPC 分析
│   └── surfaceflinger.skill.yaml  # SurfaceFlinger 分析
├── vendors/                 # 厂商定制 Skills
│   ├── oppo/               # OPPO/ColorOS 定制
│   ├── vivo/               # vivo/OriginOS 定制
│   ├── xiaomi/             # 小米/MIUI 定制
│   ├── honor/              # 荣耀/MagicOS 定制
│   ├── transsion/          # 传音 定制
│   ├── mtk/                # 联发科平台定制
│   └── qualcomm/           # 高通平台定制
└── custom/                  # 用户自定义 Skills
```

## 可用 Skills 一览

| Skill ID | 名称 | 分类 | 描述 |
|----------|------|------|------|
| `startup_analysis` | 应用启动分析 | app_lifecycle | 冷启动、温启动、热启动性能分析 |
| `scrolling_analysis` | 滑动卡顿分析 | rendering | 滑动流畅度、帧率、Jank 原因 |
| `click_response_analysis` | 点击响应分析 | input | 输入事件处理延迟 |
| `navigation_analysis` | 界面跳转分析 | app_lifecycle | Activity/Fragment 跳转性能 |
| `memory_analysis` | 内存分析 | memory | GC、堆内存、内存泄漏 |
| `cpu_analysis` | CPU 分析 | cpu | 线程调度、核心分布 |
| `binder_analysis` | Binder 分析 | ipc | IPC 调用延迟 |
| `surfaceflinger_analysis` | SurfaceFlinger 分析 | rendering | 帧合成、GPU、VSYNC |

## CLI 工具

### 列出所有 Skills

```bash
npm run skill:list
```

输出示例：
```
SmartPerfetto Skills

Found 8 skills

IPC:
  binder_analysis
    Binder 分析 v1.0.0
    分析 Binder IPC 调用延迟和跨进程通信性能

RENDERING:
  scrolling_analysis
    滑动卡顿分析 v1.0.0
    分析应用滑动流畅度、帧率、Jank 原因
    [sop]
...
```

### 验证 Skill 语法

```bash
# 验证指定 Skill
npm run skill:validate startup_analysis

# 验证所有 Skills
npm run skill:validate
```

验证内容：
- YAML 语法正确性
- 必需字段完整性 (name, version, steps)
- SQL 语法验证
- 变量引用正确性 (`${xxx}`)
- 步骤引用有效性 (save_as, for_each)

### 测试 Skill 执行

```bash
# 测试指定 Skill
npm run skill:test startup_analysis -- --trace /path/to/trace.perfetto

# 指定包名
npm run skill:test startup_analysis -- --trace /path/to/trace.perfetto --package com.example.app

# 指定厂商
npm run skill:test startup_analysis -- --trace /path/to/trace.perfetto --vendor oppo
```

## API 端点

### Skill 执行 API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/skills` | 列出所有可用 Skills |
| GET | `/api/skills/:skillId` | 获取 Skill 详情 |
| POST | `/api/skills/execute/:skillId` | 执行指定 Skill |
| POST | `/api/skills/analyze` | 自动检测意图并执行 |
| POST | `/api/skills/detect-intent` | 检测问题对应的 Skill |
| POST | `/api/skills/detect-vendor` | 检测 Trace 厂商 |

#### 执行 Skill 示例

```bash
# 执行指定 Skill
curl -X POST http://localhost:3001/api/skills/execute/startup_analysis \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "xxx",
    "package": "com.example.app"
  }'

# 自动分析（根据问题自动选择 Skill）
curl -X POST http://localhost:3001/api/skills/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "xxx",
    "question": "分析应用启动性能",
    "package": "com.example.app"
  }'
```

### Skill 管理 API (Admin)

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/admin/skills` | 列出所有 Skills (含详情) |
| GET | `/api/admin/skills/:id` | 获取 Skill 完整定义 |
| POST | `/api/admin/skills` | 创建新 Skill |
| PUT | `/api/admin/skills/:id` | 更新 Skill |
| DELETE | `/api/admin/skills/:id` | 删除 Skill (仅 custom) |
| POST | `/api/admin/skills/validate` | 验证 Skill YAML |
| POST | `/api/admin/skills/reload` | 重新加载所有 Skills |
| GET | `/api/admin/vendors` | 列出所有厂商 |
| GET | `/api/admin/vendors/:vendor/overrides` | 获取厂商 Overrides |

#### 权限控制

| 类型 | 路径 | 权限 |
|------|------|------|
| Base Skills | `skills/base/` | 只读 |
| Vendor Overrides | `skills/vendors/` | 只读 |
| Custom Skills | `skills/custom/` | 完全可编辑 |

## 快速开始

### 1. 创建新 Skill

每个 Skill 由两个文件组成：
- `xxx.skill.yaml` - 机器可执行的配置
- `xxx.sop.md` - 人类可读的 SOP 文档 (可选)

### 2. Skill YAML 格式

```yaml
# skills/base/startup.skill.yaml
name: startup_analysis
version: "1.0.0"
type: performance
category: app_lifecycle
priority: high

# 元信息
meta:
  display_name: "应用启动分析"
  description: "分析应用冷启动、温启动、热启动的性能"
  icon: "rocket"
  tags:
    - startup
    - launch
    - cold start

# 触发条件
triggers:
  keywords:
    zh:
      - 启动
      - 冷启动
      - 热启动
    en:
      - startup
      - launch
      - cold start
  patterns:
    - ".*启动速度.*"
    - ".*launch.*time.*"

# 前置检查
prerequisites:
  required_tables:
    - android_startups
    - slice
    - thread
  optional_tables:
    - android_startup_events
  modules:
    - android.startup.startups

# 分析步骤
steps:
  - id: get_startups
    name: "获取启动事件"
    sql: |
      SELECT startup_id, ts, ts + dur as ts_end, dur/1e6 as dur_ms,
             package, startup_type
      FROM android_startups
      WHERE package GLOB '${package}*'
      ORDER BY ts ASC
    required: true
    save_as: startups
    on_empty: "未检测到启动事件"

  # NOTE: 使用子查询获取 ts，避免 JavaScript 大整数精度丢失问题
  # NOTE: 使用 t.tid = p.pid 识别主线程，而非 t.name = 'main'
  - id: analyze_phases
    name: "分析关键阶段"
    for_each: startups
    sql: |
      SELECT name, dur/1e6 as dur_ms,
             (ts - (SELECT ts FROM android_startups WHERE startup_id = ${item.startup_id}))/1e6 as relative_ms
      FROM slice s
      JOIN thread_track tt ON s.track_id = tt.id
      JOIN thread t ON tt.utid = t.utid
      JOIN process p ON t.upid = p.upid
      WHERE p.name GLOB '${package}*'
        AND t.tid = p.pid  -- Main thread: tid == pid
        AND s.ts >= (SELECT ts FROM android_startups WHERE startup_id = ${item.startup_id})
        AND s.ts <= (SELECT ts + dur FROM android_startups WHERE startup_id = ${item.startup_id})
      ORDER BY s.ts ASC

# 判断标准
thresholds:
  cold_start_time:
    unit: ms
    description: "冷启动时间"
    levels:
      excellent: { max: 500 }
      good: { min: 500, max: 1000 }
      warning: { min: 1000, max: 2000 }
      critical: { min: 2000 }
    suggestions:
      warning: "启动时间偏长，建议优化"
      critical: "启动时间过长，需要重点关注"

# 输出格式
output:
  title: "启动分析报告"
  sections:
    - id: overview
      title: "启动概览"
      type: summary
      from: startups
      fields:
        - { key: startup_type, label: "启动类型" }
        - { key: dur_ms, label: "耗时", unit: "ms" }
    - id: phases
      title: "阶段详情"
      type: table
      from: analyze_phases
      fields:
        - { key: name, label: "阶段" }
        - { key: dur_ms, label: "耗时", unit: "ms" }

# 诊断规则
diagnostics:
  - id: slow_startup
    condition: "startups.any.dur_ms > 2000"
    severity: critical
    message: "启动时间超过 2 秒"
    suggestions:
      - "检查 Application.onCreate 耗时"
      - "优化 ContentProvider 初始化"
```

### 3. SOP 文档格式

```markdown
# 启动分析 SOP

## 概述
本 SOP 用于分析 Android 应用启动性能。

## 分析目标
- 启动总耗时
- 各阶段耗时分解
- 主线程阻塞原因
- CPU 资源使用情况

## 分析步骤

### Step 1: 获取启动事件
从 `android_startups` 表获取所有启动事件...

### Step 2: 分析关键阶段
检查以下关键阶段的耗时...

## 判断标准

| 指标 | 优秀 | 良好 | 警告 | 严重 |
|------|------|------|------|------|
| 冷启动时间 | <500ms | 500-1000ms | 1-2s | >2s |

## 常见问题及优化建议

### 问题1: 启动时间过长
**可能原因：**
1. Application.onCreate 耗时过长
2. ContentProvider 初始化慢
3. 主线程 IO 操作

**优化建议：**
1. 延迟初始化非必要组件
2. 使用 App Startup 库
3. 将 IO 移到后台线程
```

## 厂商定制

### 继承机制

厂商 Skill 可以继承并覆盖基础 Skill：

```yaml
# skills/vendors/oppo/startup.override.yaml
extends: base/startup
version: "1.0.0"
description: "OPPO ColorOS 启动分析"

# 添加 OPPO 特有的检测
steps:
  # 继承所有基础步骤，添加新步骤
  - id: check_coloros_boost
    name: "检查 ColorOS 加速引擎"
    sql: |
      SELECT name, dur/1e6 as dur_ms
      FROM slice
      WHERE name GLOB '*ColorOS*' OR name GLOB '*HyperBoost*'

# 覆盖阈值（OPPO 设备可能有更好的优化）
thresholds:
  cold_start_time:
    levels:
      excellent: { max: 400 }  # OPPO 优化后标准更高
```

### 厂商特有 Trace Tag

| 厂商 | 常见 Trace Tag | 用途 |
|------|---------------|------|
| OPPO | `ColorOS*`, `HyperBoost*` | 系统加速引擎 |
| vivo | `OriginOS*`, `Jovi*` | 智能优化 |
| 小米 | `MIUI*`, `Boost*` | MIUI 优化 |
| Honor | `MagicOS*`, `TurboX*` | GPU Turbo |
| MTK | `MTK*`, `MTKFB*` | 联发科平台 |
| Qualcomm | `QTI*`, `Adreno*` | 高通平台 |

## 变量说明

在 SQL 中可以使用以下变量：

| 变量 | 说明 | 示例 |
|------|------|------|
| `${package}` | 目标应用包名 | `com.example.app` |
| `${item.xxx}` | for_each 循环中的当前项 | `${item.startup_id}` |
| `${prev.xxx}` | 上一步骤的结果 | `${prev.dur_ms}` |
| `${vendor}` | 检测到的厂商 | `oppo` |
| `${result.xxx.yyy}` | 之前步骤的结果引用 | `${result.startups.0.startup_id}` |

**重要提示**:
- **时间戳精度问题**: Perfetto 的时间戳是纳秒级大整数，超过 JavaScript 安全整数范围 (2^53)。
  在 for_each 循环中，**不要直接使用 `${item.ts}`**，应使用子查询获取时间戳：
  ```sql
  -- 错误: ${item.ts} 可能因精度丢失而截断
  AND s.ts >= ${item.ts}

  -- 正确: 使用子查询保持精度
  AND s.ts >= (SELECT ts FROM android_startups WHERE startup_id = ${item.startup_id})
  ```
- **主线程识别**: 使用 `t.tid = p.pid` 而非 `t.name = 'main'`，因为主线程名称通常是包名后缀

## Perfetto UI 跳转链接

为了支持用户点击时间戳直接跳转到 Perfetto UI 中的对应位置，查询结果应包含 `ts_str` 和 `dur_str` 字段：

```sql
SELECT
  s.name as slice_name,
  s.dur / 1e6 as dur_ms,              -- 用于显示（毫秒）
  printf('%d', s.ts) as ts_str,        -- 原始纳秒时间戳（字符串）
  printf('%d', s.dur) as dur_str       -- 原始纳秒时长（字符串）
FROM slice s
...
```

**前端构建跳转链接**:
```javascript
// 使用本地 Perfetto UI
const url = `http://localhost:10000/#!/?ts=${row.ts_str}&dur=${row.dur_str}`;

// 或使用官方 Perfetto UI（需要先上传 trace）
const url = `https://ui.perfetto.dev/#!/?ts=${row.ts_str}&dur=${row.dur_str}`;

// 可选参数: visStart, visEnd 设置可视区域
const url = `...?ts=${ts_str}&dur=${dur_str}&visStart=${startNs}&visEnd=${endNs}`;
```

**支持的 URL 参数**（参考 [Perfetto Deep Linking](https://perfetto.dev/docs/visualization/deep-linking-to-perfetto-ui)）:
| 参数 | 说明 |
|------|------|
| `ts` | 时间戳（纳秒） |
| `dur` | 持续时间（纳秒） |
| `visStart`, `visEnd` | 可视区域范围 |
| `pid`, `tid` | 进程/线程 ID |
| `query` | 自动执行的 SQL 查询 |

## Skill 加载顺序

1. 加载 `base/` 目录下的基础 Skills
2. 检测设备厂商（通过 trace 内容）
3. 加载对应厂商的 override Skills
4. 加载 `custom/` 目录下的自定义 Skills

## 最佳实践

1. **保持 SQL 简洁** - 每个 step 做一件事
2. **设置合理阈值** - 基于真实数据统计
3. **添加 SOP 文档** - 让其他人理解你的分析逻辑
4. **厂商定制适度** - 只覆盖必要的部分
5. **版本管理** - 更新时递增版本号
6. **使用 optional** - 非必需的步骤设置 `optional: true`
7. **处理空结果** - 使用 `on_empty` 提供友好提示

## 贡献

欢迎提交新的 Skill 或改进现有 Skill！

1. Fork 本仓库
2. 创建 Skill 文件到 `skills/custom/` 或提 PR 到 `skills/base/`
3. 添加对应的 SOP 文档
4. 运行 `npm run skill:validate` 验证
5. 提交 Pull Request
