# V2 Skill Engine 改进计划

## 目标

将评分提升至全部 ⭐⭐⭐⭐ 以上：
- AI 介入：⭐⭐☆☆☆ → ⭐⭐⭐⭐☆
- 用户回答：⭐⭐☆☆☆ → ⭐⭐⭐⭐⭐
- 闭环完整性：⭐⭐⭐☆☆ → ⭐⭐⭐⭐⭐
- UI 利用：⭐⭐⭐☆☆ → ⭐⭐⭐⭐☆

---

## 任务 1：注入 AI 服务到 V2 Skill Engine

### 问题
- `SkillExecutorV2` 的 `aiService` 始终为 `undefined`
- `ai_decision`、`ai_summary`、`diagnostic.fallback` 均无法工作

### 解决方案

**修改文件**: `src/services/perfettoAnalysisOrchestrator.ts`

```typescript
// 在初始化 skillAdapterV2 后注入 AI 服务
if (!this.skillEngineV2Initialized) {
  await this.skillAdapterV2.ensureInitialized();

  // 注入 AI 服务
  this.skillAdapterV2.setAIService({
    chat: async (prompt: string) => {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: 'You are a performance analysis expert. Provide concise, actionable insights.',
        messages: [{ role: 'user', content: prompt }]
      });
      return response.content[0].type === 'text' ? response.content[0].text : '';
    }
  });

  this.skillEngineV2Initialized = true;
}
```

**修改文件**: `src/services/skillEngine/skillAnalysisAdapterV2.ts`

```typescript
// 增强 setAIService 方法
setAIService(aiService: { chat: (prompt: string) => Promise<string> }): void {
  (this.executor as any).aiService = aiService;
  console.log('[SkillAnalysisAdapterV2] AI service injected');
}
```

### 验收标准
- [ ] `ai_summary` 步骤能够生成自然语言总结
- [ ] `diagnostic.fallback` 在规则无法匹配时能够调用 AI

---

## 任务 2：实现智能摘要生成器（无 AI 时的兜底）

### 问题
- 当 AI 不可用时，`generateDefaultSummary` 只返回统计数字
- 用户看不到有意义的分析结论

### 解决方案

**新建文件**: `src/services/skillEngine/smartSummaryGenerator.ts`

```typescript
/**
 * 智能摘要生成器
 * 基于规则生成有意义的自然语言摘要（无需 AI）
 */

import { SkillExecutionResultV2, DiagnosticResult, DisplayResult } from './types_v2';

interface SummaryContext {
  skillId: string;
  displayResults: DisplayResult[];
  diagnostics: DiagnosticResult[];
  executionTimeMs: number;
}

export class SmartSummaryGenerator {

  /**
   * 生成智能摘要
   */
  generate(context: SummaryContext): string {
    const parts: string[] = [];

    // 1. 诊断结论优先
    if (context.diagnostics.length > 0) {
      parts.push(this.generateDiagnosticSummary(context.diagnostics));
    }

    // 2. 关键指标提取
    const keyMetrics = this.extractKeyMetrics(context);
    if (keyMetrics) {
      parts.push(keyMetrics);
    }

    // 3. 建议汇总
    const suggestions = this.aggregateSuggestions(context.diagnostics);
    if (suggestions) {
      parts.push(suggestions);
    }

    return parts.join('\n\n') || this.generateFallback(context);
  }

  /**
   * 生成诊断摘要
   */
  private generateDiagnosticSummary(diagnostics: DiagnosticResult[]): string {
    // 按严重程度排序
    const sorted = [...diagnostics].sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    });

    const critical = sorted.filter(d => d.severity === 'critical');
    const warning = sorted.filter(d => d.severity === 'warning');

    let summary = '## 诊断结论\n\n';

    if (critical.length > 0) {
      summary += `**发现 ${critical.length} 个严重问题：**\n`;
      critical.forEach((d, i) => {
        summary += `${i + 1}. ${d.diagnosis}（置信度 ${Math.round(d.confidence * 100)}%）\n`;
      });
    }

    if (warning.length > 0) {
      summary += `\n**${warning.length} 个潜在问题：**\n`;
      warning.forEach((d, i) => {
        summary += `- ${d.diagnosis}\n`;
      });
    }

    return summary;
  }

  /**
   * 从 displayResults 中提取关键指标
   */
  private extractKeyMetrics(context: SummaryContext): string | null {
    const metricsMap: Record<string, string> = {};

    for (const result of context.displayResults) {
      if (result.level === 'summary' || result.level === 'key') {
        const data = result.data;
        if (data.rows && data.rows.length > 0 && data.columns) {
          // 提取关键数值字段
          data.columns.forEach((col, idx) => {
            const value = data.rows[0][idx];
            if (this.isKeyMetric(col, value)) {
              metricsMap[this.formatMetricName(col)] = this.formatMetricValue(col, value);
            }
          });
        }
      }
    }

    if (Object.keys(metricsMap).length === 0) return null;

    let summary = '## 关键指标\n\n';
    for (const [name, value] of Object.entries(metricsMap)) {
      summary += `- **${name}**: ${value}\n`;
    }

    return summary;
  }

  /**
   * 判断是否为关键指标
   */
  private isKeyMetric(column: string, value: any): boolean {
    const keyColumns = [
      'jank_rate', 'janky_frames', 'total_frames', 'avg_frame_ms', 'max_frame_ms',
      'estimated_fps', 'total_cpu_ms', 'max_delay_ms', 'slow_calls'
    ];
    return keyColumns.includes(column) && value != null;
  }

  /**
   * 格式化指标名称
   */
  private formatMetricName(column: string): string {
    const nameMap: Record<string, string> = {
      'jank_rate': '掉帧率',
      'janky_frames': '掉帧数',
      'total_frames': '总帧数',
      'avg_frame_ms': '平均帧耗时',
      'max_frame_ms': '最大帧耗时',
      'estimated_fps': '估算帧率',
      'total_cpu_ms': 'CPU 总耗时',
      'max_delay_ms': '最大延迟',
      'slow_calls': '慢调用数'
    };
    return nameMap[column] || column;
  }

  /**
   * 格式化指标值
   */
  private formatMetricValue(column: string, value: any): string {
    if (column.endsWith('_rate')) return `${value}%`;
    if (column.endsWith('_ms')) return `${value} ms`;
    if (column === 'estimated_fps') return `${value} fps`;
    return String(value);
  }

  /**
   * 汇总优化建议
   */
  private aggregateSuggestions(diagnostics: DiagnosticResult[]): string | null {
    const allSuggestions: string[] = [];

    for (const diag of diagnostics) {
      if (diag.suggestions) {
        allSuggestions.push(...diag.suggestions);
      }
    }

    // 去重
    const unique = [...new Set(allSuggestions)];
    if (unique.length === 0) return null;

    let summary = '## 优化建议\n\n';
    unique.slice(0, 5).forEach((s, i) => {
      summary += `${i + 1}. ${s}\n`;
    });

    return summary;
  }

  /**
   * 兜底摘要
   */
  private generateFallback(context: SummaryContext): string {
    return `分析完成，耗时 ${context.executionTimeMs}ms，` +
           `共 ${context.displayResults.length} 个分析结果。`;
  }
}

export const smartSummaryGenerator = new SmartSummaryGenerator();
```

**修改文件**: `src/services/skillEngine/skillAnalysisAdapterV2.ts`

```typescript
import { smartSummaryGenerator } from './smartSummaryGenerator';

// 在 analyze 方法中
const summary = result.aiSummary || smartSummaryGenerator.generate({
  skillId: targetSkillId,
  displayResults: result.displayResults,
  diagnostics: result.diagnostics,
  executionTimeMs: result.executionTimeMs,
});
```

### 验收标准
- [ ] 无 AI 时也能生成结构化的诊断报告
- [ ] 关键指标自动提取并格式化
- [ ] 优化建议自动汇总

---

## 任务 3：增强用户问题回答能力

### 问题
- 用户问 "为什么滑动卡顿？"，系统只返回数据表格
- 缺少直接回答问题的自然语言

### 解决方案

**新建文件**: `src/services/skillEngine/answerGenerator.ts`

```typescript
/**
 * 用户问题回答生成器
 * 基于分析结果生成直接回答用户问题的自然语言
 */

import { SkillAnalysisResponseV2 } from './skillAnalysisAdapterV2';

interface QuestionContext {
  originalQuestion: string;
  skillId: string;
  response: SkillAnalysisResponseV2;
}

export class AnswerGenerator {

  /**
   * 生成直接回答
   */
  generateAnswer(context: QuestionContext): string {
    const { originalQuestion, skillId, response } = context;

    // 1. 识别问题类型
    const questionType = this.classifyQuestion(originalQuestion);

    // 2. 根据问题类型和诊断结果生成回答
    switch (questionType) {
      case 'why':
        return this.generateWhyAnswer(context);
      case 'how':
        return this.generateHowAnswer(context);
      case 'what':
        return this.generateWhatAnswer(context);
      case 'analysis':
        return this.generateAnalysisAnswer(context);
      default:
        return response.summary;
    }
  }

  /**
   * 分类问题类型
   */
  private classifyQuestion(question: string): 'why' | 'how' | 'what' | 'analysis' {
    if (/为什么|why|原因|怎么回事/.test(question)) return 'why';
    if (/怎么|如何|how|优化|改进|解决/.test(question)) return 'how';
    if (/是什么|什么是|what|有哪些/.test(question)) return 'what';
    return 'analysis';
  }

  /**
   * 生成 "为什么" 类问题的回答
   */
  private generateWhyAnswer(context: QuestionContext): string {
    const { response, originalQuestion } = context;

    if (response.diagnostics.length === 0) {
      return `分析了您提供的 trace 数据，未发现明显的性能问题。`;
    }

    // 按置信度排序，取最可能的原因
    const sorted = [...response.diagnostics].sort((a, b) => {
      const confA = typeof a.severity === 'string' ?
        (a.severity === 'critical' ? 1 : a.severity === 'warning' ? 0.7 : 0.5) : 0.5;
      const confB = typeof b.severity === 'string' ?
        (b.severity === 'critical' ? 1 : b.severity === 'warning' ? 0.7 : 0.5) : 0.5;
      return confB - confA;
    });

    const primary = sorted[0];
    const secondary = sorted.slice(1, 3);

    let answer = `**${this.extractProblemSubject(originalQuestion)}的主要原因是：${primary.message}**\n\n`;

    if (secondary.length > 0) {
      answer += `此外还发现：\n`;
      secondary.forEach(d => {
        answer += `- ${d.message}\n`;
      });
      answer += '\n';
    }

    // 添加证据
    const metrics = this.extractEvidenceMetrics(response);
    if (metrics.length > 0) {
      answer += `**数据支撑：**\n`;
      metrics.forEach(m => {
        answer += `- ${m}\n`;
      });
      answer += '\n';
    }

    // 添加建议
    if (primary.suggestions && primary.suggestions.length > 0) {
      answer += `**建议：** ${primary.suggestions[0]}`;
    }

    return answer;
  }

  /**
   * 生成 "怎么" 类问题的回答
   */
  private generateHowAnswer(context: QuestionContext): string {
    const { response } = context;

    const allSuggestions: string[] = [];
    response.diagnostics.forEach(d => {
      if (d.suggestions) allSuggestions.push(...d.suggestions);
    });

    if (allSuggestions.length === 0) {
      return `基于分析结果，当前性能表现正常，暂无优化建议。`;
    }

    let answer = `**优化方案：**\n\n`;
    [...new Set(allSuggestions)].forEach((s, i) => {
      answer += `${i + 1}. ${s}\n`;
    });

    return answer;
  }

  /**
   * 生成 "是什么" 类问题的回答
   */
  private generateWhatAnswer(context: QuestionContext): string {
    const { response } = context;

    let answer = `**分析发现：**\n\n`;

    if (response.diagnostics.length > 0) {
      response.diagnostics.forEach(d => {
        const icon = d.severity === 'critical' ? '🔴' : d.severity === 'warning' ? '🟡' : '🟢';
        answer += `${icon} ${d.message}\n`;
      });
    } else {
      answer += `未发现异常情况。\n`;
    }

    return answer;
  }

  /**
   * 生成分析类问题的回答
   */
  private generateAnalysisAnswer(context: QuestionContext): string {
    return context.response.summary;
  }

  /**
   * 从问题中提取问题主体
   */
  private extractProblemSubject(question: string): string {
    if (/滑动|scroll|fling/.test(question)) return '滑动卡顿';
    if (/启动|launch|start/.test(question)) return '启动慢';
    if (/内存|memory|oom/.test(question)) return '内存问题';
    if (/anr|无响应/.test(question)) return 'ANR';
    return '性能问题';
  }

  /**
   * 从响应中提取证据指标
   */
  private extractEvidenceMetrics(response: SkillAnalysisResponseV2): string[] {
    const metrics: string[] = [];

    for (const [key, section] of Object.entries(response.sections)) {
      if (section.data && section.data.length > 0) {
        const row = section.data[0];

        if (row.jank_rate !== undefined) {
          metrics.push(`掉帧率 ${row.jank_rate}%`);
        }
        if (row.max_frame_ms !== undefined && row.max_frame_ms > 16.67) {
          metrics.push(`最大帧耗时 ${row.max_frame_ms}ms（超过 16.67ms 阈值）`);
        }
        if (row.estimated_fps !== undefined) {
          metrics.push(`估算帧率 ${row.estimated_fps} fps`);
        }
        if (row.max_delay_ms !== undefined && row.max_delay_ms > 10) {
          metrics.push(`最大 Binder 延迟 ${row.max_delay_ms}ms`);
        }
      }
    }

    return metrics.slice(0, 5); // 最多 5 条
  }
}

export const answerGenerator = new AnswerGenerator();
```

**修改文件**: `src/services/skillEngine/skillAnalysisAdapterV2.ts`

```typescript
import { answerGenerator } from './answerGenerator';

// 在 analyze 方法最后
return {
  // ... 现有字段

  // 新增：直接回答
  directAnswer: answerGenerator.generateAnswer({
    originalQuestion: question || '',
    skillId: targetSkillId,
    response: result,
  }),
};
```

**修改类型**: `SkillAnalysisResponseV2`

```typescript
export interface SkillAnalysisResponseV2 {
  // ... 现有字段

  /** 直接回答用户问题的自然语言 */
  directAnswer?: string;
}
```

### 验收标准
- [ ] 用户问 "为什么滑动卡顿？" 能得到 "滑动卡顿的主要原因是：主线程 CPU 密集" 这样的回答
- [ ] 回答中包含数据证据支撑
- [ ] 回答中包含优化建议

---

## 任务 4：实现前端事件流消费机制

### 问题
- `SkillExecutorV2` 发出了事件，但没有消费者
- 用户看不到分析进度

### 解决方案

**修改文件**: `src/services/perfettoAnalysisOrchestrator.ts`

```typescript
// 创建事件收集器
const skillEvents: SkillEvent[] = [];
const eventHandler = (event: SkillEvent) => {
  skillEvents.push(event);

  // 通过 WebSocket 实时推送（如果有连接）
  if (this.wsConnection) {
    this.wsConnection.send(JSON.stringify({
      type: 'skill_event',
      data: event
    }));
  }
};

// 注入事件处理器
this.skillAdapterV2.setEventHandler(eventHandler);
```

**新建前端组件概念设计**: `SkillProgressIndicator`

```typescript
interface SkillProgressProps {
  events: SkillEvent[];
}

const SkillProgressIndicator: React.FC<SkillProgressProps> = ({ events }) => {
  const currentStep = events.filter(e => e.type === 'step_started').pop();
  const completedSteps = events.filter(e => e.type === 'step_completed').length;
  const totalSteps = /* 从 skill 定义获取 */;

  return (
    <div className="skill-progress">
      <ProgressBar value={completedSteps} max={totalSteps} />

      {currentStep && (
        <div className="current-step">
          正在执行: {currentStep.stepId}
          {currentStep.type === 'ai_thinking' && (
            <span className="ai-indicator">🤖 AI 思考中...</span>
          )}
        </div>
      )}

      <div className="step-timeline">
        {events.filter(e => e.type === 'step_completed').map(e => (
          <StepBadge key={e.stepId} step={e} />
        ))}
      </div>
    </div>
  );
};
```

**返回结果中包含事件**:

```typescript
// 在返回结果中包含事件供前端使用
return {
  // ... 现有字段
  executionEvents: skillEvents,
};
```

### 验收标准
- [ ] 前端能显示 "正在分析第 3/10 个区间"
- [ ] AI 思考时显示动画
- [ ] 分析完成后显示时间线

---

## 实施优先级

| 优先级 | 任务 | 预计工作量 | 影响 |
|--------|------|------------|------|
| P0 | 任务 2: 智能摘要生成器 | 2h | 立即改善用户体验 |
| P0 | 任务 3: 用户问题回答 | 2h | 核心价值 |
| P1 | 任务 1: AI 服务注入 | 1h | 解锁 AI 能力 |
| P2 | 任务 4: 事件流消费 | 3h | 提升交互体验 |

---

## 验收检查清单

### 闭环完整性
- [ ] 用户输入问题
- [ ] 系统识别意图并匹配 skill
- [ ] 执行多步骤分析
- [ ] 生成诊断结论
- [ ] **生成自然语言回答**（新增）
- [ ] 返回给用户

### AI 介入
- [ ] `ai_summary` 能生成总结
- [ ] `diagnostic.fallback` 能触发 AI
- [ ] 无 AI 时有智能兜底

### 用户回答
- [ ] "为什么" 类问题得到因果解释
- [ ] "怎么办" 类问题得到建议列表
- [ ] 回答包含数据证据

### UI 利用
- [ ] 进度条显示分析进度
- [ ] 关键指标高亮显示
- [ ] 诊断结论分级展示（critical/warning/info）
