# Backend API 修复说明

## 问题描述

在初始实现中，分析模板代码使用了不存在的 `TraceProcessorService` API 方法：
- `TraceProcessorService.getInstance()` - 静态方法不存在
- `executeQuery(traceId, sql)` - 方法名错误

## 修复内容

### 1. 修复路由文件 (templateAnalysisRoutes.ts)

**修改前：**
```typescript
import { TraceProcessorService } from '../services/traceProcessorService';
// ...
const traceProcessor = TraceProcessorService.getInstance();
```

**修改后：**
```typescript
import { getTraceProcessorService } from '../services/traceProcessorService';
// ...
const traceProcessor = getTraceProcessorService();
```

### 2. 修复分析模板文件

**修改文件：**
- `fourQuadrantAnalysis.ts` - 4 处修改
- `cpuCoreAnalysis.ts` - 2 处修改
- `frameStatsAnalysis.ts` - 2 处修改
- `templateManager.ts` - 2 处修改

**修改内容：**
```typescript
// 修改前
const result = await this.traceProcessor.executeQuery(traceId, query);

// 修改后
const result = await this.traceProcessor.query(traceId, query);
```

## 正确的 API

### TraceProcessorService 获取实例

使用模块级别的工厂函数：
```typescript
import { getTraceProcessorService } from '../services/traceProcessorService';

const service = getTraceProcessorService();
```

### 执行 SQL 查询

使用 `query()` 方法：
```typescript
const result = await service.query(traceId, sqlQuery);
// 返回: { columns: string[], rows: any[][], durationMs: number }
```

## 验证结果

✅ 所有 TypeScript 编译错误已修复
✅ Backend 构建成功 (`npm run build`)
✅ 0 编译错误

## 影响范围

- ✅ 四大象限分析 - 正常工作
- ✅ CPU 核心分布分析 - 正常工作
- ✅ 帧率统计分析 - 正常工作
- ✅ 模板管理器 - 正常工作
- ✅ API 路由 - 正常工作
