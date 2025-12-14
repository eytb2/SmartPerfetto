# 核心功能实现计划

## 立即实施（第1-2周）

### 1. 真正的 Perfetto UI Clone 集成（使用 Git Submodule）

```bash
# 1.1 添加 Perfetto Submodule
cd SmartPerfetto
git submodule add https://github.com/google/perfetto.git perfetto
git commit -m "Add perfetto submodule"

# 1.2 创建扩展目录结构
mkdir -p perfetto/ui/src/{extensions,plugins}
mkdir -p perfetto/ui/src/extensions/{ai-interaction, slice-analysis, smart-query}
```

### 2. 实现 AI-Slice 交互核心功能

#### 2.1 修改 Perfetto UI 源码
创建 `perfetto/ui/src/extensions/ai-interaction/` 目录并实现：
- `types.ts` - 定义接口
- `ai-interaction.ts` - 核心逻辑
- `ui-components.ts` - UI 组件

#### 2.2 实现关键功能
```typescript
// perfetto/ui/src/extensions/ai-interaction/slice-click-handler.ts
export class SliceClickHandler {
  // 处理 Slice 点击事件
  // 调用 AI 分析接口
  // 在 UI 上显示分析结果
  // 支持后续对话
}
```

### 3. 实现 SQL 查询 Pin 功能

```typescript
// perfetto/ui/src/extensions/query-pin/query-pin.ts
export class QueryPinManager {
  // Pin SQL 查询结果到时间线
  // 创建可视化标记
  // 支持多查询结果聚合
}
```

## 第二阶段（第2-3周）

### 4. 真实的 Trace 处理

#### 4.1 集成真实的 Trace Processor WASM
```bash
# 构建 WASM 版本
cd perfetto
python3 tools/gn gen out/wasm --args='is_debug=false target_os="wasm"'
python3 tools/ninja -C out/wasm trace_processor_wasm

# 复制到 SmartPerfetto
cp out/wasm/trace_processor.wasm ../SmartPerfetto/public/
cp out/wasm/trace_processor.js ../SmartPerfetto/public/
```

#### 4.2 实现 SQL 执行服务
```typescript
// backend/src/services/real-perfetto-processor.ts
export class RealPerfettoProcessor {
  // 使用 WASM 执行 SQL
  // 支持大数据处理
  // 返回准确的结果
}
```

### 5. 实现自动性能检测

```typescript
// perfetto/ui/src/extensions/auto-analysis/performance-detector.ts
export class PerformanceDetector {
  // 自动检测 ANR
  // 自动检测 Jank
  // 自动检测内存泄漏
  // 自动标记在 UI 上
}
```

### 6. 完善 Perfetto Config 功能

#### 6.1 创建实际配置界面
```typescript
// frontend/src/pages/PerfettoConfig.tsx
export const PerfettoConfig = () => {
  // 使用官方 UI 的配置组件
  // 嵌入到我们的页面中
  // 支持导出/导入配置
};
```

## 第三阶段（第3-4周）

### 7. 文章聚合实现

```typescript
// backend/src/services/article-aggregator.ts
export class ArticleAggregator {
  // 爬取官方文档
  // 定期更新
  // 分类管理
  // 搜索功能
}
```

### 8. 深度 AI 集成

#### 8.1 增强 AI 服务
```typescript
// backend/src/services/enhanced-ai-service.ts
export class EnhancedAIService {
  // 理解上下文
  // 多轮对话
  // 记忆功能
  // 学习用户偏好
}
```

## 关键代码示例

### 1. Slice 点击 + AI 分析
```typescript
// 1. 检测 Slice 点击
timeline.on('sliceClick', async (e) => {
  const slice = e.detail.slice;

  // 2. 显示分析中状态
  showAnalysisOverlay(slice.id);

  // 3. 调用 AI 分析
  const analysis = await analyzeSlice({
    sliceInfo: slice,
    context: getContextualInfo()
  });

  // 4. 显示结果
  displayAnalysisResults(slice.id, analysis);

  // 5. 添加到对话历史
  addToChatHistory(slice, analysis);
});
```

### 2. AI 查询自动 Pin
```typescript
// 当 AI 生成查询时
const handleAIQuery = async (query: string) => {
  // 1. 执行查询
  const result = await executeQuery(query);

  // 2. 如果有结果，自动 Pin 到时间线
  if (result.rows.length > 0) {
    const pinConfig = {
      title: `AI 分析: ${result.description}`,
      color: '#FF6B6B',
      icon: '🤖',
      data: result
    };

    await pinToTimeline(pinConfig);
  }

  // 3. 可选：询问是否需要更详细分析
  const needMoreAnalysis = await askForMoreAnalysis(result);
  if (needMoreAnalysis) {
    // 继续对话式分析
  }
};
```

### 3. 自动性能问题检测
```typescript
// 在 Trace 加载完成后
const autoAnalyze = async (traceId: string) => {
  const issues = await detectPerformanceIssues(traceId);

  // 创建问题列表
  const issueList = issues.map(issue => ({
    type: issue.type,
    severity: issue.severity,
    count: issue.count,
    examples: issue.examples.slice(0, 3)
  }));

  // 在 UI 上显示问题列表
  showProblemDashboard(issueList);

  // 自动 pin 严重问题到时间线
  issueList
    .filter(i => i.severity === 'high')
    .forEach(issue => {
      issue.examples.forEach(example => {
        pinToTimeline({
          ts: example.ts,
          name: `自动检测: ${issue.type}`,
          color: getSeverityColor(issue.severity),
          data: issue
        });
      });
    });
};
```

## 实现顺序优先级

### 第1优先级（必须完成）
1. ✅ Clone Perfetto UI 作为 Submodule
2. ✅ 实现 Slice 点击 AI 分析
3. ✅ 实现查询结果 Pin 功能
4. ✅ 集成真实 Trace Processor

### 第2优先级（重要）
1. ✅ 自动性能问题检测
2. ✅ 对话式分析功能
3. ✅ Perfetto Config 实际配置
4. ✅ 文章爬取和聚合

### 第3优先级（优化）
1. ✅ 高级 AI 功能
2. ✅ 性能优化
3. ✅ 用户体验优化
4. ✅ 更多自定义功能

## 成功标准

当以下功能全部完成时，才算真正实现您的需求：

1. ✅ 用户可以点击任意 Slice 进行 AI 分析
2. ✅ AI 生成的查询可以自动 Pin 到时间线
3. ✅ 自动检测并标记性能问题
4. ✅ 基于 Clone 的 Perfetto UI 进行二次开发
5. ✅ 支持 Config 的实际配置和导出

## 下一步

1. 立即开始实施第一个优先级
2. 使用 Git Submodule 集成官方 UI
3. 逐步添加 AI 扩展功能
4. 测试每个功能的完整性

这个计划确保了您的所有需求都能得到完整实现。