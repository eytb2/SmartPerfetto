# Perfetto SQL 生成逻辑详解

## 1. SQL 生成的核心逻辑

### 1.1 需求分析阶段

**用户输入**: "分析 com.example.androidappdemo 的启动时间"

**意图识别**:
- 目标: 应用启动性能
- 关键指标: 启动时间、启动阶段
- 过滤条件: 特定应用包名

### 1.2 表结构选择

根据需求选择Perfetto的核心表：

```sql
-- 启动时间分析需要的表：
1. slice 表 - 存储所有的trace事件（函数调用、系统事件等）
   关键字段: name, ts (timestamp), dur (duration), track_id

2. thread_track 表 - 线程轨道信息
   关键字段: id, utid

3. thread 表 - 线程信息
   关键字段: utid, name, upid, is_main_thread

4. process 表 - 进程信息
   关键字段: upid, name (包名)

5. sched 表 - CPU调度信息
   关键字段: ts, dur, cpu, utid

6. counter 表 - 计数器数据（如CPU频率）
   关键字段: ts, value, track_id

7. counter_track 表 - 计数器轨道
   关键字段: id, name
```

### 1.3 JOIN 关系构建

Perfetto表之间的关联关系：

```
slice ──(track_id)──> thread_track ──(utid)──> thread ──(upid)──> process
                                                  │
                                                  └──(utid)──> sched

counter ──(track_id)──> counter_track
```

### 1.4 实际SQL生成示例

#### 示例 1: 启动时间分析

**需求**: 获取应用的 activityStart 和 activityResume 时间

**生成步骤**:

```sql
-- Step 1: 确定目标数据
-- 需要: slice.name, slice.ts, slice.dur

-- Step 2: 确定过滤条件
-- process.name = 'com.example.androidappdemo'
-- slice.name IN ('activityStart', 'activityResume')

-- Step 3: 构建JOIN链
-- slice -> thread_track -> thread -> process

-- Step 4: 最终SQL
SELECT
    slice.name AS 阶段,
    MIN(slice.ts) / 1e9 AS 开始时间_s,  -- 纳秒转秒
    slice.dur / 1e6 AS 耗时_ms           -- 纳秒转毫秒
FROM slice
JOIN thread_track ON slice.track_id = thread_track.id
JOIN thread USING (utid)
JOIN process USING (upid)
WHERE process.name = 'com.example.androidappdemo'
  AND (slice.name = 'activityStart' OR slice.name = 'activityResume')
ORDER BY slice.ts ASC;
```

#### 示例 2: 主线程CPU核心分布

**需求**: 统计主线程在各CPU核心上的运行时间

**生成步骤**:

```sql
-- Step 1: 确定数据源
-- sched 表包含CPU调度信息

-- Step 2: 过滤条件
-- 主线程: thread.is_main_thread = 1
-- 特定应用: process.name = '...'
-- 时间范围: sched.ts BETWEEN start AND end

-- Step 3: 聚合统计
-- GROUP BY cpu
-- 统计: COUNT(*), SUM(dur), AVG(dur)

-- Step 4: 最终SQL
SELECT
    sched.cpu AS CPU核心,
    COUNT(*) AS 调度次数,
    SUM(sched.dur) / 1e6 AS 总时间_ms,
    AVG(sched.dur) / 1e6 AS 平均时间_ms
FROM sched
JOIN thread USING (utid)
JOIN process USING (upid)
WHERE process.name = 'com.example.androidappdemo'
  AND thread.is_main_thread = 1
  AND sched.ts >= 40919970000000
  AND sched.ts <= 40920200000000
GROUP BY sched.cpu
ORDER BY sched.cpu;
```

## 2. 常见SQL错误及处理

### 2.1 错误类型分类

#### 错误1: 表不存在
```sql
-- ❌ 错误
SELECT * FROM app_launch;

-- ✅ 正确 - Perfetto没有这个表，应该用slice表
SELECT * FROM slice WHERE name LIKE '%launch%';
```

#### 错误2: 字段不存在
```sql
-- ❌ 错误
SELECT cpu FROM counter;  -- counter表没有cpu字段

-- ✅ 正确 - 从track名称中提取CPU信息
SELECT
    CAST(SUBSTR(counter_track.name, 8) AS INT) AS cpu
FROM counter
JOIN counter_track ON counter.track_id = counter_track.id
WHERE counter_track.name LIKE 'cpufreq%';
```

#### 错误3: JOIN关系错误
```sql
-- ❌ 错误 - 直接JOIN process
SELECT * FROM slice JOIN process;

-- ✅ 正确 - 通过thread_track和thread中转
SELECT * FROM slice
JOIN thread_track ON slice.track_id = thread_track.id
JOIN thread USING (utid)
JOIN process USING (upid);
```

#### 错误4: 时间单位错误
```sql
-- ❌ 错误 - Perfetto的时间是纳秒，不能直接用
SELECT ts FROM slice WHERE ts > 1000;  -- 这是1微秒

-- ✅ 正确 - 要转换单位
SELECT ts / 1e9 AS time_s FROM slice WHERE ts > 1000000000;  -- 1秒
```

#### 错误5: 多行SQL在trace_processor中执行
```sql
-- ❌ 错误 - trace_processor不支持多行
SELECT
    name,
    dur
FROM slice;

-- ✅ 正确 - 必须是单行
SELECT name, dur FROM slice;
```

### 2.2 SQL验证规则

```python
# SQL验证检查点
VALIDATION_RULES = {
    # 1. 表名验证
    "valid_tables": [
        "slice", "thread", "process", "thread_track",
        "sched", "counter", "counter_track", "track"
    ],

    # 2. 常见字段验证
    "slice_fields": ["id", "name", "ts", "dur", "track_id", "category"],
    "thread_fields": ["utid", "name", "upid", "tid", "is_main_thread"],
    "process_fields": ["upid", "name", "pid"],
    "sched_fields": ["ts", "dur", "cpu", "utid", "priority"],

    # 3. JOIN键验证
    "join_keys": {
        "slice -> thread_track": "track_id = id",
        "thread_track -> thread": "utid",
        "thread -> process": "upid",
        "sched -> thread": "utid",
        "counter -> counter_track": "track_id = id"
    },

    # 4. 时间单位提示
    "time_conversions": {
        "纳秒 -> 微秒": "/ 1e3",
        "纳秒 -> 毫秒": "/ 1e6",
        "纳秒 -> 秒": "/ 1e9"
    }
}
```

## 3. SQL模板库

### 3.1 启动时间模板

```sql
-- 模板: APP_LAUNCH_TIME
-- 参数: {app_package}
-- 描述: 获取应用启动的activityStart和activityResume阶段时间
SELECT
    slice.name AS phase,
    MIN(slice.ts) / 1e9 AS start_time_s,
    slice.dur / 1e6 AS duration_ms
FROM slice
JOIN thread_track ON slice.track_id = thread_track.id
JOIN thread USING (utid)
JOIN process USING (upid)
WHERE process.name = '{app_package}'
  AND (slice.name = 'activityStart' OR slice.name = 'activityResume')
ORDER BY slice.ts ASC;
```

### 3.2 CPU核心分布模板

```sql
-- 模板: MAIN_THREAD_CPU_DISTRIBUTION
-- 参数: {app_package}, {start_ts}, {end_ts}
-- 描述: 主线程在各CPU核心上的运行时间分布
SELECT
    sched.cpu AS cpu_core,
    COUNT(*) AS schedule_count,
    SUM(sched.dur) / 1e6 AS total_time_ms,
    AVG(sched.dur) / 1e6 AS avg_time_ms
FROM sched
JOIN thread USING (utid)
JOIN process USING (upid)
WHERE process.name = '{app_package}'
  AND thread.is_main_thread = 1
  AND sched.ts >= {start_ts}
  AND sched.ts <= {end_ts}
GROUP BY sched.cpu
ORDER BY sched.cpu;
```

### 3.3 Top耗时操作模板

```sql
-- 模板: TOP_OPERATIONS
-- 参数: {app_package}, {start_ts}, {end_ts}, {min_duration_ns}, {limit}
-- 描述: 获取指定时间范围内的Top耗时操作
SELECT
    slice.name AS operation,
    slice.dur / 1e6 AS duration_ms,
    slice.ts / 1e9 AS timestamp_s,
    thread.name AS thread_name
FROM slice
JOIN thread_track ON slice.track_id = thread_track.id
JOIN thread USING (utid)
JOIN process USING (upid)
WHERE process.name = '{app_package}'
  AND slice.ts >= {start_ts}
  AND slice.ts <= {end_ts}
  AND slice.dur > {min_duration_ns}
ORDER BY slice.dur DESC
LIMIT {limit};
```

## 4. 动态SQL生成流程

### 4.1 理想的SQL生成流程

```
┌─────────────────┐
│  用户输入需求    │
│ "分析启动性能"   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  需求解析器      │
│ - 识别分析类型   │
│ - 提取参数       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  查询规划器      │
│ - 选择表        │
│ - 构建JOIN      │
│ - 添加过滤条件   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SQL生成器      │
│ - 使用模板      │
│ - 参数替换      │
│ - 格式化        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SQL验证器      │
│ - 语法检查      │
│ - 表/字段验证    │
│ - JOIN正确性    │
└────────┬────────┘
         │
      验证失败? ────Yes───┐
         │                 │
         No                ▼
         │         ┌──────────────┐
         │         │  错误修正器   │
         │         │ - 修正建议   │
         │         │ - 重新生成   │
         │         └──────┬───────┘
         │                 │
         │                 │
         ▼◄────────────────┘
┌─────────────────┐
│  执行SQL        │
│ - trace_processor│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  结果解析       │
│ - 格式化输出    │
│ - 生成报告      │
└─────────────────┘
```

### 4.2 当前流程 vs 理想流程对比

| 阶段 | 当前实现 | 理想实现 | 差距 |
|------|---------|---------|------|
| 需求输入 | 硬编码SQL | 自然语言 | 需要NLP |
| SQL生成 | 手写SQL | 模板+参数 | 需要模板引擎 |
| 验证 | 无 | 自动验证 | 需要验证器 |
| 错误处理 | 无 | 自动修正 | 需要错误处理器 |
| 执行 | 命令行 | API调用 | 已实现 |
| 结果展示 | 文本 | 结构化数据 | 需要格式化 |

## 5. 如何集成到现有流程

### 5.1 现有系统架构

```
SmartPerfetto/
├── backend/
│   ├── aiService.ts     # AI服务，生成SQL
│   ├── sqlValidator.ts  # SQL验证器（已存在但不完善）
│   └── traceController.ts
├── cli/
│   └── analyze.py       # 命令行工具（新增）
└── scripts/
    └── analyze_launch_simple.sh
```

### 5.2 改进方案

#### 方案1: 完善SQL验证器（短期）

在现有的 `sqlValidator.ts` 中添加：

```typescript
// backend/src/services/sqlValidator.ts 改进
class PerfettoSQLValidator {
  private templates: Map<string, SQLTemplate>;

  // 添加SQL模板库
  loadTemplates() {
    this.templates.set('app_launch_time', {
      sql: `SELECT slice.name, ...`,
      params: ['app_package'],
      description: '应用启动时间分析'
    });
  }

  // 增强验证功能
  validateSQL(sql: string): ValidationResult {
    // 1. 检查表名
    // 2. 检查JOIN关系
    // 3. 检查时间单位转换
    // 4. 检查是否单行（trace_processor要求）
  }

  // 新增：SQL修正建议
  suggestFix(sql: string, error: string): string {
    // 根据错误类型提供修正建议
  }
}
```

#### 方案2: 建立SQL模板库（中期）

创建新文件存储所有SQL模板：

```typescript
// backend/src/data/sqlTemplates.ts
export const SQL_TEMPLATES = {
  APP_LAUNCH_TIME: {
    sql: `SELECT slice.name AS phase, MIN(slice.ts) / 1e9 AS start_time_s, slice.dur / 1e6 AS duration_ms FROM slice JOIN thread_track ON slice.track_id = thread_track.id JOIN thread USING (utid) JOIN process USING (upid) WHERE process.name = '{app_package}' AND (slice.name = 'activityStart' OR slice.name = 'activityResume') ORDER BY slice.ts ASC;`,
    params: ['app_package'],
    category: 'launch'
  },

  MAIN_THREAD_CPU_DIST: {
    sql: `SELECT sched.cpu, COUNT(*) AS count, SUM(sched.dur) / 1e6 AS total_ms FROM sched JOIN thread USING (utid) JOIN process USING (upid) WHERE process.name = '{app_package}' AND thread.is_main_thread = 1 AND sched.ts >= {start_ts} AND sched.ts <= {end_ts} GROUP BY sched.cpu ORDER BY sched.cpu;`,
    params: ['app_package', 'start_ts', 'end_ts'],
    category: 'cpu'
  }
};
```

#### 方案3: AI + 模板混合模式（长期）

```typescript
// backend/src/services/queryPlanner.ts
class QueryPlanner {
  async planQuery(userRequest: string): Promise<QueryPlan> {
    // 1. 先尝试匹配模板
    const template = this.matchTemplate(userRequest);
    if (template) {
      return { useTemplate: true, template, params: extractParams(userRequest) };
    }

    // 2. 如果没有匹配的模板，使用AI生成
    const aiGenerated = await this.aiService.generateSQL(userRequest);

    // 3. 验证AI生成的SQL
    const validation = this.validator.validate(aiGenerated);

    // 4. 如果验证失败，尝试修正
    if (!validation.isValid) {
      const fixed = this.fixer.fix(aiGenerated, validation.errors);
      return { useTemplate: false, sql: fixed };
    }

    return { useTemplate: false, sql: aiGenerated };
  }
}
```

## 6. 实施步骤

### Phase 1: 立即可做（1-2天）
1. ✅ 创建SQL模板文档（此文档）
2. ✅ 整理当前正确的SQL查询
3. 📝 创建SQL模板文件
4. 📝 完善sqlValidator.ts

### Phase 2: 短期改进（1周）
1. 📝 实现SQLTemplateEngine
2. 📝 添加参数验证
3. 📝 增强错误提示
4. 📝 添加SQL修正建议

### Phase 3: 中期优化（2-4周）
1. 📝 实现QueryPlanner
2. 📝 集成AI生成 + 模板验证
3. 📝 添加查询缓存
4. 📝 性能优化

## 7. 错误处理最佳实践

```typescript
// 示例：完整的SQL执行流程
async function executePerfettoQuery(userRequest: string) {
  try {
    // 1. 生成SQL
    const plan = await queryPlanner.plan(userRequest);

    // 2. 验证
    const validation = validator.validate(plan.sql);
    if (!validation.isValid) {
      throw new SQLValidationError(validation.errors);
    }

    // 3. 执行
    const result = await traceProcessor.execute(plan.sql);

    // 4. 解析结果
    return resultParser.parse(result);

  } catch (error) {
    if (error instanceof SQLValidationError) {
      // 尝试自动修正
      const fixed = await fixer.autoFix(plan.sql, error);
      return executePerfettoQuery(fixed); // 递归重试
    }

    // 记录错误并返回友好提示
    logger.error('SQL execution failed', error);
    return {
      success: false,
      error: '查询执行失败',
      suggestion: getSuggestion(error)
    };
  }
}
```

## 8. 总结

### 关键要点

1. **SQL生成逻辑**: 需求 → 表选择 → JOIN构建 → 过滤条件 → 生成SQL
2. **错误类型**: 表不存在、字段错误、JOIN错误、时间单位、多行SQL
3. **解决方案**: 模板库 + 验证器 + 修正器
4. **集成路径**: 短期完善验证 → 中期建立模板 → 长期AI+模板混合

### 下一步行动

1. 立即创建SQL模板库
2. 完善SQL验证器
3. 实现自动错误修正
4. 集成到现有的AI服务中
