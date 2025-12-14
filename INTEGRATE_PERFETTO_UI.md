# 集成官方 Perfetto UI 到 SmartPerfetto

本文档说明如何将官方 Perfetto UI 源码集成到 SmartPerfetto 项目中进行二次开发。

## 集成方案选择

### 方案一：使用 Git Submodule（推荐）
将 Perfetto 仓库作为 Git Submodule 集成，这样可以：
1. 跟踪官方更新
2. 在官方代码基础上修改
3. 保持版本控制

### 方案二：Fork + Custom Build
Fork 官方仓库并在上面开发，适合深度定制。

## 实施步骤（使用 Submodule）

### 1. 添加 Submodule
```bash
# 在 SmartPerfetto 目录
git submodule add https://github.com/google/perfetto.git perfetto
git commit -m "Add perfetto submodule"
```

### 2. 构建配置更新
修改 `perfetto/ui/package.json`，添加我们的依赖：
```json
{
  "name": "perfetto-ui-smart",
  "dependencies": {
    // ... 原有依赖
    "smart-perfetto-bridge": "^1.0.0"
  },
  "scripts": {
    // ... 原有脚本
    "build:with-extensions": "npm run build && npm run build-extensions"
  }
}
```

### 3. 创建扩展代码目录
```bash
mkdir -p perfetto/ui/src/extensions
```

### 4. 修改构建流程
更新 `perfetto/ui/build.js` 以包含我们的扩展：
```javascript
// 添加扩展构建步骤
const buildExtensions = () => {
  console.log('Building SmartPerfetto extensions...');
  // 构建我们的扩展代码
  execSync('npm run build-extensions', { cwd: path.join(__dirname, '../extensions') });
};

// 在主要构建流程后调用
buildAll();
buildExtensions();
```

## 核心扩展开发

### 1. AI 交互扩展

#### 扩展定义
```typescript
// perfetto/ui/src/extensions/ai-interaction/types.ts
export interface AIGeneratedQuery {
  id: string;
  query: string;
  explanation: string;
  insights: string[];
  timestamp: number;
}

export interface SliceAnalysis {
  sliceId: number;
  title: string;
  insights: string[];
  suggestions: string[];
}
```

#### UI 扩展实现
```typescript
// perfetto/ui/src/extensions/ai-interaction/ai-interaction.ts
import { FrontendConnection } from '../core/frontend_connection';
import { PerfettoSqlQueryResult } from '../core/sql_utils';

export class AIInteractionExtension {
  private connection: FrontendConnection;

  constructor(connection: FrontendConnection) {
    this.connection = connection;
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // 监听 Slice 点击事件
    this.connection.addEventListener('slice-selected', (e) => {
      this.handleSliceSelected(e.slice);
    });

    // 添加 AI 查询生成按钮
    this.connection.addEventListener('show-ai-panel', () => {
      this.showAIPanel();
    });
  }

  private async handleSliceSelected(slice: SliceInfo) {
    // 显示分析面板
    const analysis = await this.analyzeSlice(slice);
    this.displaySliceAnalysis(analysis);
  }

  private async analyzeSlice(slice: SliceInfo): Promise<SliceAnalysis> {
    // 调用 AI API 分析
    const response = await fetch('/api/ai/analyze-slice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sliceInfo: slice,
        traceId: this.getTraceId(),
      }),
    });

    return response.json();
  }

  private displaySliceAnalysis(analysis: SliceAnalysis) {
    // 在 UI 上显示分析结果
    this.connection.createSliceAnnotation({
      sliceId: analysis.sliceId,
      title: 'AI Analysis',
      insights: analysis.insights,
      suggestions: analysis.suggestions,
    });
  }

  private showAIPanel() {
    // 显示 AI 查询面板
    this.connection.postMessage({
      type: 'SHOW_AI_PANEL',
    });
  }

  async pinQueryToUI(query: string, title: string) {
    // 将查询 pin 到时间线
    const result = await this.executePerfettoQuery(query);

    // 在时间线上显示结果
    this.connection.pinQueryResult({
      title,
      query,
      result: result,
    });
  }

  private async executePerfettoQuery(query: string): Promise<PerfettoSqlQueryResult> {
    return this.connection.query(query);
  }
}
```

### 2. SQL 编辑器扩展
```typescript
// perfetto/ui/src/extensions/sql-editor/sql-editor.ts
export class EnhancedSQLEditor {
  // 增强 SQL 编辑器，添加 AI 功能
  setupAIButton(editor: any) {
    editor.addButton({
      icon: '🤖',
      title: 'Generate with AI',
      onClick: async () => {
        const naturalLanguage = prompt('Describe what you want to analyze:');
        if (naturalLanguage) {
          const generatedQuery = await this.generateSQLFromNaturalLanguage(naturalLanguage);
          editor.setValue(generatedQuery);
        }
      }
    });

    editor.addButton({
      icon: '📌',
      title: 'Pin to Timeline',
      onClick: () => {
        const query = editor.getValue();
        this.pinQueryToTimeline(query);
      }
    });
  }
}
```

### 3. 时间线扩展
```typescript
// perfetto/ui/src/extensions/timeline/timeline-annotations.ts
export class TimelineAnnotationManager {
  private annotations: Map<number, Annotation> = new Map();

  addSliceAnnotation(annotation: SliceAnnotation) {
    this.annotations.set(annotation.sliceId, annotation);
    this.renderAnnotation(annotation);
  }

  renderAnnotation(annotation: SliceAnnotation) {
    // 在时间线上渲染标注
    const element = this.findSliceElement(annotation.sliceId);
    if (element) {
      element.classList.add('ai-annotation');
      element.title = annotation.title;

      // 添加标注标记
      const marker = document.createElement('div');
      marker.className = 'ai-annotation-marker';
      marker.innerHTML = '🤖';
      marker.title = annotation.insights.join('\n');
      element.appendChild(marker);
    }
  }

  private findSliceElement(sliceId: number): HTMLElement | null {
    // 查找对应的 slice 元素
    return document.querySelector(`[data-slice-id="${sliceId}"]`);
  }
}
```

### 4. 对话式分析面板
```typescript
// perfetto/ui/src/extensions/ai-chat/ai-chat-panel.ts
export class AIChatPanel {
  private container: HTMLElement;
  private messages: ChatMessage[] = [];
  private traceId: string;

  constructor(traceId: string) {
    this.traceId = traceId;
    this.container = this.createChatPanel();
    this.setupEventHandlers();
  }

  private createChatPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'ai-chat-panel';
    panel.innerHTML = `
      <div class="ai-chat-header">
        <h3>AI 分析助手</h3>
        <button class="minimize-btn">_</button>
        <button class="close-btn">×</button>
      </div>
      <div class="ai-chat-messages">
        <!-- 聊天消息将显示在这里 -->
      </div>
      <div class="ai-chat-input">
        <textarea placeholder="询问关于 Trace 的任何问题..."></textarea>
        <button class="send-btn">发送</button>
      </div>
    `;
    return panel;
  }

  async sendMessage(message: string) {
    // 添加用户消息
    this.addMessage('user', message);

    // 显示加载状态
    this.addMessage('assistant', '正在分析...', true);

    try {
      // 调用 AI 服务
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          traceId: this.traceId,
        }),
      });

      const result = await response.json();

      // 移除加载消息
      this.removeLastMessage();

      // 添加 AI 响应
      this.addMessage('assistant', result.response);

      // 如果包含查询，执行并 pin 到 UI
      if (result.queries) {
        for (const query of result.queries) {
          await this.executeAndPinQuery(query);
        }
      }

    } catch (error) {
      console.error('Chat error:', error);
      this.removeLastMessage();
      this.addMessage('assistant', '抱歉，分析时出错。请稍后重试。');
    }
  }

  private async executeAndPinQuery(query: string) {
    // 执行查询
    const result = await this.executePerfettoQuery(query);

    // Pin 到时间线
    if (result.rows && result.rows.length > 0) {
      this.pinResultsToTimeline(result);
    }
  }
}
```

## 关键功能实现

### 1. Slice 点击分析

当用户点击时间线上的 Slice 时：

```typescript
// 事件监听
timeline.addEventListener('slice-click', async (event) => {
  const slice = event.slice;

  // 发送分析请求
  const analysis = await fetch('/api/ai/analyze-slice', {
    method: 'POST',
    body: JSON.stringify({ slice })
  }).then(r => r.json());

  // 显示分析结果
  showSliceAnalysis(analysis);
});
```

### 2. AI 查询结果 Pin

```typescript
// 执行查询并 Pin
async function executeAndPinQuery(query: string) {
  // 执行 SQL 查询
  const result = await executeSQL(query);

  // 在时间线上创建标记
  result.rows.forEach(row => {
    if (row.ts && row.name) {
      createTimelineMarker({
        ts: row.ts,
        name: `AI: ${row.name}`,
        type: 'ai-query-result',
        color: '#FF6B6B'
      });
    }
  });
}
```

### 3. 自动检测性能问题

```typescript
// 在加载 Trace 后自动分析
async function autoAnalyzePerformanceIssues(traceId: string) {
  // 自动检测 ANR
  const anrQuery = `
    SELECT *
    FROM slice
    WHERE dur > 5000000000  -- 5秒
      AND category = 'Java'
    ORDER BY dur DESC
  `;

  const anrs = await executeSQL(anrQuery);

  if (anrs.length > 0) {
    createPerformanceIssueMarkers({
      type: 'ANR',
      count: anrs.length,
      locations: anrs
    });
  }

  // 自动检测卡顿
  const jankQuery = `
    SELECT *
    FROM slice
    WHERE category = 'gfx'
      AND dur > 16670000  -- 16.67ms (60fps)
  `;

  const jankFrames = await executeSQL(jankQuery);
  if (jankFrames.length > 0) {
    createPerformanceIssueMarkers({
      type: 'JANK',
      count: jankFrames.length,
      locations: jankFrames
    });
  }
}
```

## 构建和部署

### 1. 开发模式
```bash
# 启动扩展开发模式
cd perfetto/ui
npm run dev-with-extensions
```

### 2. 生产构建
```bash
# 构建包含扩展的 UI
npm run build:with-extensions
```

### 3. 集成到 SmartPerfetto
将构建好的文件复制到 SmartPerfetto：
```bash
cp -r perfetto/ui/out/dist/* SmartPerfetto/public/
```

## API 扩展

### 1. 新增 AI 分析接口
```typescript
// backend/src/routes/ai.ts
router.post('/analyze-slice', authController.authenticate, async (req, res) => {
  const { sliceInfo } = req.body;

  // 调用 AI 服务分析
  const analysis = await aiService.analyzeSlice(sliceInfo);

  res.json(analysis);
});

router.post('/chat', authController.authenticate, async (req, res) => {
  const { message, traceId } = req.body;

  // 对话式分析
  const response = await aiService.chatAnalyze(message, traceId);

  res.json(response);
});
```

### 2. 扩展 TraceProcessor 服务
```typescript
// backend/src/services/perfettoService.ts
export class PerfettoService {
  async analyzeSlice(tracePath: string, sliceInfo: SliceInfo): Promise<SliceAnalysis> {
    // 分析特定 slice
    const queries = [
      // 检查相关的系统调用
      `SELECT * FROM ftrace_event
       WHERE ts BETWEEN ${sliceInfo.ts} AND ${sliceInfo.ts + sliceInfo.dur}
         AND utid = ${sliceInfo.utid}`,
      // 检查相关的内存分配
      `SELECT * FROM heap_profile_allocation
       WHERE ts BETWEEN ${sliceInfo.ts} AND ${sliceInfo.ts + sliceInfo.dur}
         AND upid = ${sliceInfo.upid}`,
    ];

    const results = await Promise.all(
      queries.map(q => this.executeQuery(tracePath, q))
    );

    return this.analyzeSliceResults(results, sliceInfo);
  }
}
```

这样集成才能真正满足您的需求，实现对 Perfetto UI 的深度控制和 AI 功能集成。