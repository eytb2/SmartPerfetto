# AI 辅助导航增强功能实现计划

## 概述

基于"AI增强专家分析"的理念，我们需要实现两大核心功能：
1. **智能导航**：帮助专家快速定位到Trace上的关键点
2. **智能统计**：AI自动执行复杂的数据聚合和分析

---

## 一、智能导航功能

### 1.1 功能目标

当AI分析发现关键时间点（如掉帧、ANR、慢函数）时，用户可以：
- 点击时间戳直接跳转到Perfetto UI对应位置
- 查看该时间点的上下文信息
- 在多个关键点之间快速切换

### 1.2 实现方案

#### 前端部分 (Perfetto UI Plugin)

**文件**: `perfetto/ui/src/plugins/com.smartperfetto.AIAssistant/sql_result_table.ts`

##### 功能1: 时间戳列识别

```typescript
interface TimestampColumn {
  columnIndex: number;
  columnName: string;
  timeUnit: 'ns' | 'us' | 'ms' | 's';  // Perfetto使用纳秒
}

// 在SqlResultTable组件中添加
private detectTimestampColumns(columns: string[]): TimestampColumn[] {
  const tsPatterns = [
    /^ts$/i,           // 标准的ts列
    /timestamp/i,      // 包含timestamp
    /^start_ts$/i,     // 启动时间
    /^end_ts$/i,       // 结束时间
    /^dur$/i,          // 持续时间
  ];

  return columns
    .map((col, idx) => ({ col, idx }))
    .filter(({ col }) => tsPatterns.some(p => p.test(col)))
    .map(({ col, idx }) => ({
      columnIndex: idx,
      columnName: col,
      timeUnit: 'ns', // Perfetto默认纳秒
    }));
}
```

##### 功能2: 可点击的时间戳单元格

```typescript
// 渲染表格时，为时间戳单元格添加跳转按钮
private renderCell(
  value: any,
  columnIndex: number,
  rowIndex: number
): m.Children {
  const isTimestamp = this.timestampColumns.some(
    tc => tc.columnIndex === columnIndex
  );

  if (isTimestamp && typeof value === 'number') {
    return m('td.timestamp-cell', [
      m('span.timestamp-value', this.formatTimestamp(value)),
      m('button.jump-btn', {
        onclick: () => this.jumpToTimestamp(value),
        title: '跳转到 Perfetto Timeline'
      }, '📍'),
    ]);
  }

  return m('td', value);
}

// 跳转逻辑
private jumpToTimestamp(timestampNs: number) {
  const timeSeconds = timestampNs / 1e9;

  // 使用Perfetto API跳转并高亮
  this.trace.timeline.panToTimestamp(timestampNs);

  // 可选：高亮该时间点附近的tracks
  this.trace.timeline.highlightTimeRange({
    start: timestampNs - 1e6, // 前后1ms
    end: timestampNs + 1e6,
  });

  // 切换到Timeline视图
  this.trace.tabs.showTab('current_selection');
}
```

##### 功能3: 批量导航 - "关键点书签栏"

```typescript
interface NavigationBookmark {
  id: string;
  timestamp: number;
  label: string;
  type: 'jank' | 'anr' | 'slow_function' | 'custom';
}

// 在AI Panel顶部添加书签栏
class NavigationBookmarkBar {
  private bookmarks: NavigationBookmark[] = [];
  private currentIndex: number = 0;

  view(): m.Children {
    return m('.bookmark-bar', [
      m('button.nav-btn', {
        onclick: () => this.jumpToPrevious(),
        disabled: this.currentIndex === 0,
      }, '← 上一个'),

      m('.bookmark-list',
        this.bookmarks.map((bm, idx) =>
          m('button.bookmark', {
            class: idx === this.currentIndex ? 'active' : '',
            onclick: () => this.jumpTo(idx),
          }, [
            this.getIcon(bm.type),
            bm.label,
          ])
        )
      ),

      m('button.nav-btn', {
        onclick: () => this.jumpToNext(),
        disabled: this.currentIndex === this.bookmarks.length - 1,
      }, '下一个 →'),
    ]);
  }

  // AI分析完成后，自动添加书签
  addBookmarksFromAnalysis(results: SqlQueryResult) {
    // 假设AI返回了掉帧点
    results.rows.forEach((row, idx) => {
      const timestamp = row[0]; // 假设第一列是ts
      this.bookmarks.push({
        id: `jank-${idx}`,
        timestamp: timestamp as number,
        label: `掉帧 #${idx + 1}`,
        type: 'jank',
      });
    });
  }
}
```

#### 后端部分

**文件**: `backend/src/services/perfettoAnalysisOrchestrator.ts`

##### 增强分析结果，标注关键时间点

```typescript
interface AnalysisResult {
  answer: string;
  keyTimestamps?: KeyTimestamp[];  // 新增
  statistics?: AnalysisStatistics;  // 新增
}

interface KeyTimestamp {
  timestamp: number;
  type: 'jank' | 'anr' | 'slow_function' | 'binder_slow';
  description: string;
  context?: {
    threadName?: string;
    processName?: string;
    sliceName?: string;
  };
}

// 在分析编排器中识别关键点
private async extractKeyTimestamps(
  query: string,
  results: any[][]
): Promise<KeyTimestamp[]> {
  // 如果查询是关于掉帧的
  if (query.toLowerCase().includes('jank') ||
      query.toLowerCase().includes('掉帧')) {
    return results.map(row => ({
      timestamp: row[0], // 假设ts是第一列
      type: 'jank',
      description: `Frame jank at ${row[0]}ns`,
      context: {
        threadName: row[1], // 根据实际SQL结果调整
      },
    }));
  }

  // 其他类型的关键点...
  return [];
}
```

---

## 二、智能统计分析功能

### 2.1 预定义分析模板

#### 模板1: 四大象限分析（Binder/Lock/IO/Computation）

**后端新增**: `backend/src/services/analysisTemplates/fourQuadrantAnalysis.ts`

```typescript
export class FourQuadrantAnalyzer {
  async analyze(
    traceId: string,
    startTs: number,
    endTs: number
  ): Promise<FourQuadrantResult> {
    const queries = {
      // 1. Binder耗时
      binder: `
        SELECT
          SUM(dur) / 1e6 as total_ms,
          COUNT(*) as count
        FROM slice
        WHERE name LIKE '%binder%'
          AND ts >= ${startTs}
          AND ts <= ${endTs}
      `,

      // 2. Lock等待
      lock: `
        SELECT
          SUM(dur) / 1e6 as total_ms,
          COUNT(*) as count
        FROM slice
        WHERE name LIKE '%lock%' OR name LIKE '%mutex%'
          AND ts >= ${startTs}
          AND ts <= ${endTs}
      `,

      // 3. IO操作
      io: `
        SELECT
          SUM(dur) / 1e6 as total_ms,
          COUNT(*) as count
        FROM slice
        WHERE name LIKE '%read%' OR name LIKE '%write%'
          AND ts >= ${startTs}
          AND ts <= ${endTs}
      `,

      // 4. CPU计算（排除上述类型）
      computation: `
        SELECT
          SUM(dur) / 1e6 as total_ms,
          COUNT(*) as count
        FROM slice
        WHERE name NOT LIKE '%binder%'
          AND name NOT LIKE '%lock%'
          AND name NOT LIKE '%read%'
          AND name NOT LIKE '%write%'
          AND ts >= ${startTs}
          AND ts <= ${endTs}
      `,
    };

    // 执行所有查询
    const results = await Promise.all(
      Object.entries(queries).map(async ([key, sql]) => ({
        category: key,
        ...(await this.traceProcessor.executeQuery(traceId, sql)),
      }))
    );

    return this.formatResults(results);
  }

  private formatResults(results: any[]): FourQuadrantResult {
    const total = results.reduce((sum, r) => sum + r.total_ms, 0);

    return {
      summary: {
        totalMs: total,
        breakdown: results.map(r => ({
          category: r.category,
          durationMs: r.total_ms,
          percentage: (r.total_ms / total) * 100,
          count: r.count,
        })),
      },
      visualization: {
        type: 'pie_chart',
        data: results.map(r => ({
          label: r.category,
          value: r.total_ms,
        })),
      },
    };
  }
}
```

#### 模板2: CPU大小核分布分析

```typescript
export class CpuCoreAnalyzer {
  async analyze(
    traceId: string,
    threadId: number,
    startTs: number,
    endTs: number
  ): Promise<CpuCoreDistribution> {
    const sql = `
      SELECT
        cpu,
        COUNT(*) as slice_count,
        SUM(dur) / 1e6 as total_ms,
        AVG(dur) / 1e6 as avg_ms
      FROM sched_slice
      WHERE utid = ${threadId}
        AND ts >= ${startTs}
        AND ts <= ${endTs}
      GROUP BY cpu
      ORDER BY cpu
    `;

    const results = await this.traceProcessor.executeQuery(traceId, sql);

    // 假设CPU 0-3 是小核，4-7 是大核
    const littleCores = results.filter(r => r.cpu < 4);
    const bigCores = results.filter(r => r.cpu >= 4);

    return {
      littleCoreTime: littleCores.reduce((sum, r) => sum + r.total_ms, 0),
      bigCoreTime: bigCores.reduce((sum, r) => sum + r.total_ms, 0),
      breakdown: results,
    };
  }
}
```

### 2.2 AI自动选择模板

在 `perfettoAnalysisOrchestrator.ts` 中添加：

```typescript
private async selectAnalysisTemplate(
  question: string
): Promise<AnalysisTemplate | null> {
  // 使用AI判断需要哪种分析
  const prompt = `
    用户问题: "${question}"

    请判断这个问题适合用哪种预定义分析模板：
    1. four_quadrant - 四大象限分析（Binder/Lock/IO/Computation）
    2. cpu_core_distribution - CPU大小核分布
    3. frame_stats - 帧率统计（fps, jank, p95/p99）
    4. memory_allocation - 内存分配分析
    5. custom - 需要自定义SQL

    只返回模板名称。
  `;

  const response = await this.aiClient.complete(prompt);
  const templateName = response.trim();

  if (templateName === 'four_quadrant') {
    return new FourQuadrantTemplate();
  }
  // ... 其他模板

  return null;
}
```

---

## 三、UI优化

### 3.1 结果表格增强

在 `sql_result_table.ts` 中添加导出和可视化功能：

```typescript
class SqlResultTable {
  view(): m.Children {
    return m('.sql-result-container', [
      // 工具栏
      m('.result-toolbar', [
        m('button.export-csv', {
          onclick: () => this.exportCSV(),
        }, '📄 导出CSV'),

        m('button.export-json', {
          onclick: () => this.exportJSON(),
        }, '📋 导出JSON'),

        // 如果检测到数值列，提供图表按钮
        this.canVisualize() && m('button.visualize', {
          onclick: () => this.showChart(),
        }, '📊 生成图表'),
      ]),

      // 表格主体
      this.renderTable(),

      // 可选的图表视图
      this.state.showChart && this.renderChart(),
    ]);
  }

  private canVisualize(): boolean {
    // 检测是否有数值列可以可视化
    return this.result.columns.some(col =>
      /count|total|sum|avg|ms|duration/i.test(col)
    );
  }

  private renderChart(): m.Children {
    // 使用简单的SVG或Canvas绘制柱状图/饼图
    // 或者集成轻量级图表库如 Chart.js
    return m('.chart-container', [
      m('h4', '数据可视化'),
      // ... 图表实现
    ]);
  }
}
```

### 3.2 样式优化

```css
/* 时间戳单元格样式 */
.timestamp-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.jump-btn {
  padding: 2px 6px;
  font-size: 12px;
  cursor: pointer;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 4px;
  transition: background 0.2s;
}

.jump-btn:hover {
  background: var(--primary-hover);
}

/* 书签栏样式 */
.bookmark-bar {
  display: flex;
  gap: 8px;
  padding: 12px;
  background: #f5f5f5;
  border-bottom: 1px solid #ddd;
  overflow-x: auto;
}

.bookmark {
  padding: 6px 12px;
  background: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.bookmark.active {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}
```

---

## 四、实现优先级

### Phase 1: 基础导航功能（1-2周）
- [x] 时间戳列识别
- [ ] 点击跳转到Perfetto
- [ ] 基础的时间范围高亮

### Phase 2: 书签和批量导航（1周）
- [ ] 关键点书签栏
- [ ] 前后切换功能
- [ ] AI自动识别关键点

### Phase 3: 统计分析模板（2-3周）
- [ ] 四大象限分析模板
- [ ] CPU大小核分布
- [ ] 帧率统计模板
- [ ] AI自动选择模板

### Phase 4: 可视化和导出（1-2周）
- [ ] 结果图表化
- [ ] CSV/JSON导出
- [ ] 分析报告生成

---

## 五、技术难点和解决方案

### 5.1 Perfetto Timeline API调用

**问题**: 如何从插件中控制Perfetto的Timeline视图？

**解决方案**:
```typescript
// 查看Perfetto源码中的Timeline API
// 文件: ui/src/public/trace.ts

interface Trace {
  timeline: {
    panToTimestamp(ts: number): void;
    setViewportTime(start: number, end: number): void;
    // ...
  };
}
```

### 5.2 SQL结果和时间戳格式

**问题**: Perfetto的时间戳是纳秒，但显示时需要转换

**解决方案**:
```typescript
private formatTimestamp(ns: number): string {
  const ms = ns / 1e6;
  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  }
  const sec = ms / 1000;
  return `${sec.toFixed(2)}s`;
}
```

### 5.3 大数据集性能

**问题**: 如果SQL返回10000+行，表格渲染会卡

**解决方案**: 虚拟滚动
```typescript
// 使用虚拟滚动库，如 react-window 的概念
private renderVirtualizedTable() {
  const visibleRows = this.getVisibleRows(
    this.scrollTop,
    this.rowHeight
  );

  return visibleRows.map(row => this.renderRow(row));
}
```

---

## 六、测试计划

### 单元测试
- [ ] 时间戳列检测逻辑
- [ ] 时间格式转换
- [ ] 书签管理逻辑

### 集成测试
- [ ] 上传Trace → AI分析 → 跳转Timeline 全流程
- [ ] 多个关键点之间切换
- [ ] 导出功能

### 性能测试
- [ ] 大表格渲染性能（10000+行）
- [ ] 复杂SQL查询响应时间
- [ ] 内存占用

---

## 七、参考资料

1. Perfetto UI 插件开发文档:
   - https://perfetto.dev/docs/visualization/perfetto-ui-plugin-api

2. Perfetto SQL 参考:
   - https://perfetto.dev/docs/analysis/sql-tables

3. TypeScript + Mithril.js:
   - https://mithril.js.org/

---

## 附录：完整的使用流程示例

```
用户: "帮我找出所有掉帧的点"

AI:
  1. 生成SQL: SELECT ts, dur, frame_number FROM actual_frame_timeline_slice WHERE dur > 16000000
  2. 执行查询，返回20个掉帧点
  3. 前端接收结果，自动：
     - 在书签栏显示"掉帧 #1" 到 "掉帧 #20"
     - 表格中的ts列添加📍按钮

用户点击:
  - 点击"掉帧 #1" → 跳转到Perfetto, 高亮该帧
  - 点击"下一个" → 跳转到掉帧 #2
  - 点击表格中的📍 → 跳转到该精确时间点

用户: "分析一下主线程的四大象限"

AI:
  1. 识别到需要四大象限分析
  2. 自动执行4个SQL查询
  3. 返回可视化结果:
     - Binder: 30% (450ms)
     - Lock: 10% (150ms)
     - IO: 20% (300ms)
     - Computation: 40% (600ms)
  4. 前端显示饼图
  5. 提供CSV导出按钮
```

这样，AI就真正成为了专家的"增强型副驾驶"！
