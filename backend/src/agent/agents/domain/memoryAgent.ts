/**
 * SmartPerfetto Memory Agent
 *
 * Phase 2.5: AI Agent for memory analysis
 *
 * Skills wrapped as tools (lazy-loaded at executeTask time):
 * - memory_analysis
 * - gc_analysis
 * - lmk_analysis
 * - dmabuf_analysis
 */

import { BaseAgent, SkillDefinitionForAgent, TaskUnderstanding, ExecutionResult } from '../base/baseAgent';
import {
  AgentTask,
  AgentTaskContext,
  Hypothesis,
} from '../../types/agentProtocol';
import { Finding } from '../../types';
import { ModelRouter } from '../../core/modelRouter';
import { getAdbAgentTools } from '../tools/adbTools';

// =============================================================================
// Memory Agent Configuration
// =============================================================================

/**
 * Memory Agent Skills
 *
 * Each skill description includes:
 * - What it does
 * - When to use it (scenario)
 * - What output to expect
 */
const MEMORY_SKILLS: SkillDefinitionForAgent[] = [
  {
    skillId: 'memory_analysis',
    toolName: 'analyze_memory_overview',
    description: '【内存概览分析】分析内存使用概况，包括各进程内存分布、PSS/RSS。适用于：首次分析内存、获取内存使用全景。输出：进程内存排行+内存分类统计',
    category: 'memory',
  },
  {
    skillId: 'gc_analysis',
    toolName: 'analyze_gc',
    description: '【GC活动分析】分析垃圾回收活动，检测频繁GC和长时间GC。适用于：怀疑GC影响性能、内存抖动。输出：GC事件列表+类型统计+耗时分布（注意：分析全局GC可能输出较多）',
    category: 'memory',
  },
  {
    skillId: 'lmk_analysis',
    toolName: 'analyze_lmk',
    description: '【LMK分析】分析Low Memory Killer活动，检测进程被杀情况。适用于：应用被杀、内存压力大。输出：LMK事件列表+被杀进程信息',
    category: 'memory',
  },
  {
    skillId: 'dmabuf_analysis',
    toolName: 'analyze_dmabuf',
    description: '【DMA-BUF分析】分析DMA-BUF内存使用，检测图形内存泄漏。适用于：GPU内存问题、图形buffer泄漏。输出：DMA-BUF分配统计',
    category: 'memory',
  },
];

// =============================================================================
// Memory Agent Implementation
// =============================================================================

export class MemoryAgent extends BaseAgent {
  constructor(modelRouter: ModelRouter) {
    super(
      {
        id: 'memory_agent',
        name: 'Memory Analysis Agent',
        domain: 'memory',
        description: 'AI agent specialized in memory, GC, and LMK analysis',
        tools: [...getAdbAgentTools()],
        maxIterations: 3,
        confidenceThreshold: 0.7,
        canDelegate: true,
        delegateTo: ['cpu_agent', 'frame_agent'],
      },
      modelRouter,
      MEMORY_SKILLS
    );
  }

  protected buildUnderstandingPrompt(task: AgentTask): string {
    return `你是一个内存分析专家 Agent，负责分析 Android 系统的内存问题。

## 任务
${task.description}

## 上下文
- 用户查询: ${task.context.query}
${task.context.hypothesis ? `- 当前假设: ${task.context.hypothesis.description}` : ''}
${this.formatTaskContext(task)}

${this.getToolSectionForPrompt()}

请以 JSON 返回：{"objective":"","questions":[],"relevantAreas":[],"recommendedTools":[],"constraints":[],"confidence":0.7}`;
  }

  protected buildPlanningPrompt(understanding: TaskUnderstanding, task: AgentTask): string {
    return `规划内存分析：目标 ${understanding.objective}

${this.getToolSectionForPrompt()}

请以 JSON 返回：{"steps":[{"toolName":"","params":{},"purpose":""}],"expectedOutcomes":[],"estimatedTimeMs":30000,"confidence":0.7}`;
  }

  protected buildReflectionPrompt(result: ExecutionResult, task: AgentTask): string {
    return `反思内存分析：发现 ${result.findings.map(f => f.title).join(', ') || '无'}

请以 JSON 返回：{"insights":[],"objectivesMet":${result.success},"findingsConfidence":0.7,"gaps":[],"nextSteps":[],"hypothesisUpdates":[],"questionsForOthers":[]}`;
  }

  protected async generateHypotheses(findings: Finding[]): Promise<Hypothesis[]> {
    const hypotheses: Hypothesis[] = [];
    const memoryFindings = findings.filter(f =>
      f.title.includes('内存') || f.title.includes('GC') || f.title.includes('LMK') || f.title.includes('memory')
    );

    if (memoryFindings.length > 0) {
      hypotheses.push(this.createHypothesis(
        '内存压力导致性能问题',
        0.6,
        memoryFindings.map(f => ({ id: f.id, description: f.title, source: 'memory_agent', type: 'finding' as const, strength: 0.7 }))
      ));
    }

    return hypotheses;
  }

  protected getRecommendedTools(context: AgentTaskContext): string[] {
    const query = context.query?.toLowerCase() || '';
    const hasTimeRange = !!context.timeRange;
    const tools: string[] = ['analyze_memory_overview'];

    // When a focused time range exists (e.g. a jank interval), prefer memory_analysis which now supports start_ts/end_ts.
    // Avoid gc_analysis here because it may analyze the whole trace and overwhelm the output.
    if (!hasTimeRange && (query.includes('gc') || query.includes('垃圾回收'))) tools.push('analyze_gc');
    if (query.includes('lmk') || query.includes('oom') || query.includes('kill')) tools.push('analyze_lmk');
    if (query.includes('dmabuf') || query.includes('gpu内存')) tools.push('analyze_dmabuf');

    return [...new Set(tools)];
  }
}

export function createMemoryAgent(modelRouter: ModelRouter): MemoryAgent {
  return new MemoryAgent(modelRouter);
}

export default MemoryAgent;
