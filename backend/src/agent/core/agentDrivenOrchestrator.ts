/**
 * SmartPerfetto Agent-Driven Orchestrator
 *
 * Phase 3: Transform from "AI-assisted deterministic executor" to "AI Agents driven" system
 *
 * This orchestrator:
 * 1. Uses AI to understand user intent and generate hypotheses
 * 2. Dynamically dispatches tasks to domain agents based on hypotheses
 * 3. Collects and synthesizes feedback from agents
 * 4. Runs multi-round iterations until conclusions are reached
 * 5. Generates intelligent, evidence-backed conclusions
 *
 * Architecture:
 * User Query → Master Agent (AI decision core)
 *                    ↓
 *           Dynamic task dispatch
 *                    ↓
 *      ┌────────┬────────┬────────┬────────┐
 *      ↓        ↓        ↓        ↓        ↓
 *   Frame    CPU     Binder   Memory    ...
 *   Agent   Agent    Agent    Agent
 *      └────────┴────────┴────────┴────────┘
 *                    ↓
 *           Feedback & Reasoning
 *                    ↓
 *      Master Agent synthesizes findings,
 *      dispatches more tasks if needed
 *                    ↓
 *         AI-generated insights
 */

import { EventEmitter } from 'events';
import {
  Intent,
  Finding,
  StreamingUpdate,
  Evaluation,
} from '../types';
import {
  AgentTask,
  AgentResponse,
  Hypothesis,
  SharedAgentContext,
  createTaskId,
  createHypothesisId,
} from '../types/agentProtocol';
import { ModelRouter } from './modelRouter';
import { AgentMessageBus, createAgentMessageBus } from '../communication';
import {
  DomainAgentRegistry,
  createDomainAgentRegistry,
} from '../agents/domain';
import {
  IterationStrategyPlanner,
  createIterationStrategyPlanner,
  StrategyDecision,
} from '../agents/iterationStrategyPlanner';
import {
  EnhancedSessionContext,
  sessionContextManager,
} from '../context/enhancedSessionContext';
import {
  createStrategyRegistry,
  StrategyRegistry,
  StrategyExecutionState,
  FocusInterval,
  StagedAnalysisStrategy,
  StageDefinition,
  intervalHelpers,
} from '../strategies';

// =============================================================================
// Types
// =============================================================================

export interface AgentDrivenOrchestratorConfig {
  /** Maximum analysis rounds */
  maxRounds: number;
  /** Maximum concurrent agent tasks */
  maxConcurrentTasks: number;
  /** Confidence threshold to conclude */
  confidenceThreshold: number;
  /** Stop after consecutive rounds with no new evidence */
  maxNoProgressRounds: number;
  /** Stop after consecutive rounds with mostly failed tasks */
  maxFailureRounds: number;
  /** Enable logging */
  enableLogging: boolean;
  /** Streaming callback */
  streamingCallback?: (update: StreamingUpdate) => void;
}

const DEFAULT_CONFIG: AgentDrivenOrchestratorConfig = {
  maxRounds: 5,
  maxConcurrentTasks: 3,
  confidenceThreshold: 0.7,
  maxNoProgressRounds: 2,
  maxFailureRounds: 2,
  enableLogging: true,
};

interface TaskGraphNode {
  id: string;
  domain: string;
  description: string;
  evidenceNeeded: string[];
  timeRange?: { start: number | string; end: number | string };
  dependsOn?: string[];
  priority?: number;
}

interface TaskGraphPlan {
  nodes: TaskGraphNode[];
  reasoning?: string;
}

const DOMAIN_ALIASES: Record<string, string> = {
  gpu: 'frame',
  render: 'frame',
  rendering: 'frame',
  surfaceflinger: 'frame',
  sf: 'frame',
  choreographer: 'frame',
  ui: 'frame',
  input: 'interaction',
  touch: 'interaction',
  interaction: 'interaction',
  binder: 'binder',
  ipc: 'binder',
  lock: 'binder',
  memory: 'memory',
  gc: 'memory',
  art: 'memory',
  startup: 'startup',
  launch: 'startup',
  coldstart: 'startup',
  anr: 'anr',
  systemserver: 'system',
  system: 'system',
  thermal: 'system',
  io: 'system',
  power: 'system',
};

const DEFAULT_EVIDENCE: Record<string, string[]> = {
  frame: ['jank frames', 'frame durations', 'fps', 'frame timeline'],
  cpu: ['cpu load', 'runqueue latency', 'cpu frequency', 'thread hotspots'],
  binder: ['binder call latency', 'thread blocking', 'lock contention'],
  memory: ['heap usage', 'gc pauses', 'allocation spikes', 'lmk events'],
  startup: ['cold start duration', 'main thread blocking', 'io latency'],
  interaction: ['input latency', 'dispatch delay', 'response time'],
  anr: ['anr traces', 'blocked main thread', 'binder waits'],
  system: ['thermal throttling', 'io stalls', 'system_server workload'],
};

export interface AnalysisResult {
  sessionId: string;
  success: boolean;
  findings: Finding[];
  hypotheses: Hypothesis[];
  conclusion: string;
  confidence: number;
  rounds: number;
  totalDurationMs: number;
}

// =============================================================================
// Agent-Driven Orchestrator
// =============================================================================

/**
 * Agent-Driven Orchestrator
 *
 * This is the AI decision core that coordinates domain agents
 * through dynamic task dispatch and feedback synthesis.
 */
export class AgentDrivenOrchestrator extends EventEmitter {
  private config: AgentDrivenOrchestratorConfig;
  private modelRouter: ModelRouter;
  private messageBus: AgentMessageBus;
  private agentRegistry: DomainAgentRegistry;
  private strategyPlanner: IterationStrategyPlanner;
  private strategyRegistry: StrategyRegistry;
  private sessionContext: EnhancedSessionContext | null = null;
  private currentRound: number = 0;
  private noProgressRounds: number = 0;
  private failureRounds: number = 0;
  private stopReason: string | null = null;

  constructor(modelRouter: ModelRouter, config?: Partial<AgentDrivenOrchestratorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.modelRouter = modelRouter;

    // Initialize components
    this.messageBus = createAgentMessageBus({
      maxConcurrentTasks: this.config.maxConcurrentTasks,
      enableLogging: this.config.enableLogging,
    });

    this.agentRegistry = createDomainAgentRegistry(modelRouter);
    this.strategyPlanner = createIterationStrategyPlanner(modelRouter);
    this.strategyRegistry = createStrategyRegistry();

    // Register all agents with message bus
    for (const agent of this.agentRegistry.getAll()) {
      this.messageBus.registerAgent(agent);
    }

    // Set up event forwarding
    this.setupEventForwarding();
  }

  // ==========================================================================
  // Core Analysis Method
  // ==========================================================================

  /**
   * Run agent-driven analysis
   */
  async analyze(
    query: string,
    sessionId: string,
    traceId: string,
    options: {
      traceProcessorService?: any;
      packageName?: string;
      timeRange?: { start: number | string; end: number | string };
    } = {}
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    this.currentRound = 0;
    this.noProgressRounds = 0;
    this.failureRounds = 0;
    this.stopReason = null;
    this.strategyPlanner.resetProgressTracking();

    this.log(`Starting agent-driven analysis for: ${query}`);
    this.emitUpdate('progress', { phase: 'starting', message: '开始 AI Agent 分析' });

    try {
      // 1. Initialize session context
      this.sessionContext = sessionContextManager.getOrCreate(sessionId, traceId);
      const sharedContext = this.messageBus.createSharedContext(sessionId, traceId);

      // 2. Understand intent and generate initial hypotheses
      this.emitUpdate('progress', { phase: 'understanding', message: '理解用户意图' });
      const intent = await this.understandIntent(query);
      const initialHypotheses = await this.generateInitialHypotheses(query, intent);

      // Add hypotheses to shared context
      for (const hypothesis of initialHypotheses) {
        this.messageBus.updateHypothesis(hypothesis);
      }

      this.emitUpdate('progress', {
        phase: 'hypotheses_generated',
        message: `生成 ${initialHypotheses.length} 个假设`,
        hypotheses: initialHypotheses.map(h => h.description),
      });

      // 3. Run analysis loop
      let allFindings: Finding[] = [];
      let lastStrategy: StrategyDecision | null = null;
      let informationGaps: string[] = [];

      // Check if a staged analysis strategy matches this query
      const matchedStrategy = this.strategyRegistry.match(query);

      if (matchedStrategy) {
        // Execute the matched strategy's staged pipeline
        const strategyResult = await this.executeStrategy(
          matchedStrategy, query, intent, sharedContext, allFindings, options
        );
        allFindings = strategyResult.findings;
        lastStrategy = strategyResult.lastStrategy;
        informationGaps = strategyResult.informationGaps;
      }

      // Generic analysis loop (only runs if no strategy was matched)
      while (!matchedStrategy && this.currentRound < this.config.maxRounds) {
        this.currentRound++;
        this.log(`=== Round ${this.currentRound}/${this.config.maxRounds} ===`);

        this.emitUpdate('progress', {
          phase: 'round_start',
          round: this.currentRound,
          maxRounds: this.config.maxRounds,
          message: `分析轮次 ${this.currentRound}`,
        });

        // 3a. Plan task graph and dispatch tasks
        const taskGraph = await this.planTaskGraph(query, intent, sharedContext, informationGaps, options);
        const tasks = this.buildTasksFromGraph(taskGraph, query, intent, sharedContext, options);

        if (tasks.length === 0) {
          this.stopReason = 'No tasks generated from task graph';
          this.log('No tasks to dispatch, concluding');
          break;
        }

        sharedContext.userContext = {
          ...(sharedContext.userContext || {}),
          lastTaskGraph: taskGraph,
        };

        this.emitUpdate('progress', {
          phase: 'task_graph_planned',
          taskCount: tasks.length,
          taskGraph: taskGraph.nodes.map(node => ({
            id: node.id,
            domain: node.domain,
            description: node.description,
            evidenceNeeded: node.evidenceNeeded,
            dependsOn: node.dependsOn,
          })),
          message: `生成任务图 (${tasks.length} 个任务)`,
        });

        this.emitUpdate('progress', {
          phase: 'tasks_dispatched',
          taskCount: tasks.length,
          agents: tasks.map(t => t.targetAgentId),
          message: `派发 ${tasks.length} 个任务`,
        });

        // 3b. Execute tasks with dependency ordering
        const responses = await this.executeTaskGraph(tasks);

        // Emit DataEnvelope results from tools
        this.emitDataEnvelopes(responses);

        // 3c. Synthesize feedback
        const synthesis = await this.synthesizeFeedback(responses, sharedContext);

        this.emitUpdate('progress', {
          phase: 'synthesis_complete',
          confirmedFindings: synthesis.confirmedFindings.length,
          updatedHypotheses: synthesis.updatedHypotheses.length,
          message: `综合 ${responses.length} 个 Agent 反馈`,
        });

        informationGaps = synthesis.informationGaps;

        // Collect findings
        allFindings.push(...synthesis.newFindings);

        // Emit findings
        if (synthesis.newFindings.length > 0) {
          this.emitUpdate('finding', {
            round: this.currentRound,
            findings: synthesis.newFindings,
          });
        }

        // Simplified circuit breaker: stop if no progress or excessive failures
        if (this.evaluateEarlyStop(responses, synthesis.newFindings.length)) {
          this.emitUpdate('progress', {
            phase: 'early_stop',
            reason: this.stopReason,
            noProgressRounds: this.noProgressRounds,
            failureRounds: this.failureRounds,
            message: `提前终止: ${this.stopReason}`,
          });
          break;
        }

        // 3d. Decide next strategy
        const strategyContext = {
          evaluation: this.buildEvaluation(allFindings, sharedContext),
          previousResults: [],
          intent,
          iterationCount: this.currentRound,
          maxIterations: this.config.maxRounds,
          allFindings,
        };

        lastStrategy = await this.strategyPlanner.planNextIteration(strategyContext);

        this.emitUpdate('progress', {
          phase: 'strategy_decision',
          strategy: lastStrategy.strategy,
          confidence: lastStrategy.confidence,
          reasoning: lastStrategy.reasoning,
          message: `策略: ${this.translateStrategy(lastStrategy.strategy)}`,
        });

        if (lastStrategy.strategy === 'conclude') {
          this.log('Strategy: conclude - ending analysis');
          break;
        }

        // Handle deep_dive: update context and add additional skills to investigate
        if (lastStrategy.strategy === 'deep_dive' && lastStrategy.focusArea) {
          this.log(`Strategy: deep_dive - focusing on ${lastStrategy.focusArea}`);
          sharedContext.focusedTimeRange = options.timeRange;

          const deepDiveHypothesis = this.createHypothesis(
            `深入分析 ${lastStrategy.focusArea} 领域`, 0.6
          );
          deepDiveHypothesis.status = 'investigating';
          this.messageBus.updateHypothesis(deepDiveHypothesis);
        }

        // Handle pivot: change analysis direction
        if (lastStrategy.strategy === 'pivot' && lastStrategy.newDirection) {
          this.log(`Strategy: pivot - changing direction to ${lastStrategy.newDirection}`);

          // Reset investigating hypotheses to proposed
          for (const hypothesis of sharedContext.hypotheses.values()) {
            if (hypothesis.status === 'investigating') {
              hypothesis.status = 'proposed';
              hypothesis.confidence = Math.max(0.3, hypothesis.confidence - 0.2);
              hypothesis.updatedAt = Date.now();
            }
          }

          this.messageBus.updateHypothesis(
            this.createHypothesis(lastStrategy.newDirection, 0.5)
          );
        }
      }

      // 4. Generate conclusion
      this.emitUpdate('progress', { phase: 'concluding', message: '生成分析结论' });
      const conclusion = await this.generateConclusion(sharedContext, allFindings, intent, this.stopReason || undefined);

      this.emitUpdate('conclusion', {
        sessionId,
        summary: conclusion,
        confidence: lastStrategy?.confidence || 0.5,
        rounds: this.currentRound,
      });

      const result: AnalysisResult = {
        sessionId,
        success: true,
        findings: allFindings,
        hypotheses: Array.from(sharedContext.hypotheses.values()),
        conclusion,
        confidence: lastStrategy?.confidence || 0.5,
        rounds: this.currentRound,
        totalDurationMs: Date.now() - startTime,
      };

      this.log(`Analysis complete: ${allFindings.length} findings, ${this.currentRound} rounds`);
      return result;

    } catch (error: any) {
      this.log(`Analysis failed: ${error.message}`);
      this.emitUpdate('error', { message: error.message });

      return {
        sessionId,
        success: false,
        findings: [],
        hypotheses: [],
        conclusion: `分析失败: ${error.message}`,
        confidence: 0,
        rounds: this.currentRound,
        totalDurationMs: Date.now() - startTime,
      };
    }
  }

  // ==========================================================================
  // Intent Understanding
  // ==========================================================================

  private async understandIntent(query: string): Promise<Intent> {
    const prompt = `分析以下用户查询，提取分析意图：

用户查询: "${query}"

请以 JSON 格式返回：
{
  "primaryGoal": "用户的主要目标",
  "aspects": ["需要分析的方面"],
  "expectedOutputType": "diagnosis | comparison | timeline | summary",
  "complexity": "simple | moderate | complex"
}`;

    try {
      const response = await this.modelRouter.callWithFallback(prompt, 'intent_understanding');
      const jsonMatch = response.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as Intent;
      }
    } catch (error) {
      this.log(`Failed to parse intent: ${error}`);
    }

    return {
      primaryGoal: query,
      aspects: ['general'],
      expectedOutputType: 'diagnosis',
      complexity: 'moderate',
    };
  }

  // ==========================================================================
  // Hypothesis Generation
  // ==========================================================================

  private async generateInitialHypotheses(query: string, intent: Intent): Promise<Hypothesis[]> {
    const prompt = `基于以下用户查询，生成可能的性能问题假设：

用户查询: "${query}"
分析目标: ${intent.primaryGoal}
分析方面: ${intent.aspects.join(', ')}

请以 JSON 格式返回假设列表：
{
  "hypotheses": [
    {
      "description": "假设描述",
      "confidence": 0.5,
      "relevantAgents": ["frame_agent", "cpu_agent"]
    }
  ]
}

注意：对于滑动/卡顿类问题，请务必包含以下关键假设方向：
- App 自身运行时间过长（主线程/RenderThread 耗时操作，如布局计算、绘制、业务逻辑）
- 帧率不稳定或掉帧
- CPU 调度不合理（被调度到小核、等待调度时间过长）
- 系统级问题（SurfaceFlinger、GPU、Binder IPC）

可用的 Agent:
${this.agentRegistry.getAgentDescriptionsForLLM()}`;

    try {
      const response = await this.modelRouter.callWithFallback(prompt, 'planning');
      const jsonMatch = response.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return (parsed.hypotheses || []).map((h: any) => ({
          id: createHypothesisId(),
          description: h.description,
          confidence: h.confidence || 0.5,
          status: 'proposed' as const,
          supportingEvidence: [],
          contradictingEvidence: [],
          proposedBy: 'master_orchestrator',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          relevantAgents: h.relevantAgents,
        }));
      }
    } catch (error) {
      this.log(`Failed to generate hypotheses: ${error}`);
    }

    // Default hypothesis based on query keywords
    return this.generateDefaultHypotheses(query, intent);
  }

  private generateDefaultHypotheses(query: string, _intent: Intent): Hypothesis[] {
    const hypotheses: Hypothesis[] = [];
    const queryLower = query.toLowerCase();

    if (queryLower.includes('卡顿') || queryLower.includes('jank')) {
      hypotheses.push(this.createHypothesis('帧渲染超时导致卡顿', 0.6));
    }

    if (queryLower.includes('滑动') || queryLower.includes('scroll')) {
      hypotheses.push(
        this.createHypothesis('滑动过程中存在帧率不稳定或掉帧现象', 0.7, ['frame_agent']),
        this.createHypothesis('App 自身运行时间过长（主线程或 RenderThread 耗时操作导致帧超时）', 0.75, ['frame_agent', 'cpu_agent']),
      );
    }

    if (hypotheses.length === 0) {
      hypotheses.push(this.createHypothesis('存在性能问题需要诊断', 0.5));
    }

    return hypotheses;
  }

  private createHypothesis(
    description: string,
    confidence: number,
    relevantAgents?: string[]
  ): Hypothesis {
    const now = Date.now();
    return {
      id: createHypothesisId(),
      description,
      confidence,
      status: 'proposed',
      supportingEvidence: [],
      contradictingEvidence: [],
      proposedBy: 'master_orchestrator',
      createdAt: now,
      updatedAt: now,
      ...(relevantAgents && { relevantAgents }),
    };
  }

  // ==========================================================================
  // Task Graph Planning
  // ==========================================================================

  private async planTaskGraph(
    query: string,
    intent: Intent,
    sharedContext: SharedAgentContext,
    informationGaps: string[],
    options: any
  ): Promise<TaskGraphPlan> {
    const hypotheses = Array.from(sharedContext.hypotheses.values())
      .filter(h => h.status === 'proposed' || h.status === 'investigating');
    const allowedDomains = ['frame', 'cpu', 'binder', 'memory', 'startup', 'interaction', 'anr', 'system', 'gpu', 'surfaceflinger', 'input', 'art'];

    const prompt = `你是主编排 Agent，需要输出任务图（Task Graph）。任务图要求：
- 每个任务只包含“证据与指标产出”，不要输出最终结论。
- 每个节点必须包含 domain、time_range、evidence_needed。
- domain 必须来自允许列表。

用户查询: "${query}"
分析目标: ${intent.primaryGoal}
当前假设:
${hypotheses.map(h => `- ${h.description} (confidence: ${h.confidence.toFixed(2)})`).join('\n') || '无'}

已确认发现:
${sharedContext.confirmedFindings.map(f => `- [${f.severity}] ${f.title}`).join('\n') || '无'}

信息缺口:
${informationGaps.join('\n') || '无'}

可用 domain:
${allowedDomains.join(', ')}

请以 JSON 格式返回：
{
  "reasoning": "简要说明",
  "tasks": [
    {
      "id": "t1",
      "domain": "cpu",
      "description": "要收集的证据或指标",
      "evidence_needed": ["指标1", "指标2"],
      "time_range": { "start": 0, "end": 0 } | null,
      "depends_on": ["t0"],
      "priority": 1
    }
  ]
}

注意：
- time_range 无法确定时请返回 null。
- 只输出 JSON。`;

    try {
      const response = await this.modelRouter.callWithFallback(prompt, 'planning');
      const jsonMatch = response.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
        const nodes = tasks.map((task: any, index: number): TaskGraphNode => {
          const id = String(task.id || `task_${index + 1}`);
          const domain = String(task.domain || '').toLowerCase();
          const evidenceNeeded = Array.isArray(task.evidence_needed)
            ? task.evidence_needed.map((e: any) => String(e))
            : Array.isArray(task.evidenceNeeded)
              ? task.evidenceNeeded.map((e: any) => String(e))
              : [];
          const timeRange = this.parseTimeRange(task.time_range ?? task.timeRange, options, sharedContext);
          const dependsOn = Array.isArray(task.depends_on)
            ? task.depends_on.map((d: any) => String(d))
            : Array.isArray(task.dependsOn)
              ? task.dependsOn.map((d: any) => String(d))
              : [];
          const priority = typeof task.priority === 'number' ? task.priority : 5;

          return {
            id,
            domain: domain || 'frame',
            description: String(task.description || task.task || '收集证据'),
            evidenceNeeded,
            timeRange,
            dependsOn,
            priority,
          };
        });

        this.addMandatoryDomainsIfMissing(nodes, query, intent, sharedContext, options);
        return { nodes, reasoning: parsed.reasoning };
      }
    } catch (error) {
      this.log(`Failed to plan task graph: ${error}`);
    }

    const fallbackNodes = this.buildFallbackTaskGraph(query, intent, sharedContext, options);
    this.addMandatoryDomainsIfMissing(fallbackNodes, query, intent, sharedContext, options);
    return { nodes: fallbackNodes };
  }

  private addMandatoryDomainsIfMissing(
    nodes: TaskGraphNode[],
    query: string,
    intent: Intent,
    sharedContext: SharedAgentContext,
    options: any
  ): void {
    const queryLower = query.toLowerCase();
    const requiredDomains: string[] = [];

    const scrollOrJank =
      queryLower.includes('滑动') ||
      queryLower.includes('scroll') ||
      queryLower.includes('jank') ||
      queryLower.includes('掉帧') ||
      queryLower.includes('卡顿');

    if (scrollOrJank) {
      requiredDomains.push('frame');
    }

    if (requiredDomains.length === 0) return;

    const existingDomains = new Set(nodes.map(n => this.normalizeDomain(n.domain)));

    for (const domain of requiredDomains) {
      if (existingDomains.has(domain)) continue;
      nodes.push({
        id: `mandatory_${domain}_${Date.now()}`,
        domain,
        description: `补充 ${domain} 关键证据与指标`,
        evidenceNeeded: DEFAULT_EVIDENCE[domain] || ['关键指标', '异常点'],
        timeRange: this.parseTimeRange(null, options, sharedContext),
        dependsOn: [],
        priority: 2,
      });
    }
  }

  private buildFallbackTaskGraph(
    query: string,
    intent: Intent,
    sharedContext: SharedAgentContext,
    options: any
  ): TaskGraphNode[] {
    const nodes: TaskGraphNode[] = [];
    const relevantAgents = this.agentRegistry.getAgentsForTopic(query);
    const fallbackAgents = relevantAgents.length > 0
      ? relevantAgents
      : this.agentRegistry.getAll().slice(0, 3);

    fallbackAgents.slice(0, 3).forEach((agent, index) => {
      const domain = agent.config.domain || 'frame';
      nodes.push({
        id: `fallback_${domain}_${index + 1}`,
        domain,
        description: `收集 ${domain} 相关证据与指标`,
        evidenceNeeded: DEFAULT_EVIDENCE[domain] || ['关键指标', '异常点'],
        timeRange: this.parseTimeRange(null, options, sharedContext),
        dependsOn: [],
        priority: 5,
      });
    });

    return nodes;
  }

  private buildTasksFromGraph(
    taskGraph: TaskGraphPlan,
    query: string,
    intent: Intent,
    sharedContext: SharedAgentContext,
    options: any
  ): AgentTask[] {
    const tasks: AgentTask[] = [];
    const hypotheses = Array.from(sharedContext.hypotheses.values())
      .filter(h => h.status === 'proposed' || h.status === 'investigating');

    for (const node of taskGraph.nodes) {
      const resolvedDomain = this.normalizeDomain(node.domain);
      const agentId = this.resolveAgentIdForDomain(resolvedDomain, query);
      if (!agentId) {
        this.log(`No agent for domain: ${node.domain}`);
        continue;
      }
      const evidenceNeeded = node.evidenceNeeded.length > 0
        ? node.evidenceNeeded
        : (DEFAULT_EVIDENCE[resolvedDomain] || ['关键指标', '异常点']);

      tasks.push({
        id: node.id || createTaskId(),
        description: node.description,
        targetAgentId: agentId,
        priority: node.priority || 5,
        context: {
          query,
          intent: {
            primaryGoal: intent.primaryGoal,
            aspects: intent.aspects,
          },
          hypothesis: hypotheses[0],
          domain: resolvedDomain,
          timeRange: node.timeRange,
          evidenceNeeded,
          relevantFindings: sharedContext.confirmedFindings.slice(-5),
          additionalData: {
            traceProcessorService: options.traceProcessorService,
            packageName: options.packageName,
          },
        },
        dependencies: node.dependsOn || [],
        createdAt: Date.now(),
      });
    }

    return tasks;
  }

  // ==========================================================================
  // Generic Strategy Execution
  // ==========================================================================

  /**
   * Execute a matched staged analysis strategy.
   * Iterates through stages, building tasks from templates, executing them,
   * and optionally extracting focus intervals between stages.
   */
  private async executeStrategy(
    strategy: StagedAnalysisStrategy,
    query: string,
    intent: Intent,
    sharedContext: SharedAgentContext,
    existingFindings: Finding[],
    options: any
  ): Promise<{
    findings: Finding[];
    lastStrategy: StrategyDecision | null;
    confidence: number;
    informationGaps: string[];
  }> {
    const allFindings = [...existingFindings];
    let lastStrategy: StrategyDecision | null = null;
    let stagedConfidence = 0.5;
    let informationGaps: string[] = [];

    const state: StrategyExecutionState = {
      strategyId: strategy.id,
      currentStageIndex: 0,
      focusIntervals: [],
      confidence: 0.5,
    };

    this.log(`Executing strategy: ${strategy.name} (${strategy.stages.length} stages)`);

    for (let i = 0; i < strategy.stages.length; i++) {
      const stage = strategy.stages[i];
      state.currentStageIndex = i;
      this.currentRound++;

      // 1. Emit progress with template interpolation
      const progressMessage = stage.progressMessageTemplate
        .replace('{{stageIndex}}', String(i + 1))
        .replace('{{totalStages}}', String(strategy.stages.length));

      this.emitUpdate('progress', {
        phase: 'round_start',
        round: i + 1,
        maxRounds: strategy.stages.length,
        message: progressMessage,
      });

      // 2. Build tasks from stage templates
      const tasks = this.buildStageTasks(stage, state.focusIntervals, query, intent, sharedContext, options);
      if (tasks.length === 0) {
        this.stopReason = `No tasks generated for strategy stage: ${stage.name}`;
        break;
      }

      this.emitUpdate('progress', {
        phase: 'tasks_dispatched',
        taskCount: tasks.length,
        agents: tasks.map(t => t.targetAgentId),
        message: `派发 ${tasks.length} 个任务`,
      });

      // 3. Execute tasks and synthesize feedback
      const responses = await this.executeTaskGraph(tasks);
      this.emitDataEnvelopes(responses);

      const synthesis = await this.synthesizeFeedback(responses, sharedContext);
      this.emitUpdate('progress', {
        phase: 'synthesis_complete',
        confirmedFindings: synthesis.confirmedFindings.length,
        updatedHypotheses: synthesis.updatedHypotheses.length,
        message: `综合 ${responses.length} 个 Agent 反馈`,
      });

      informationGaps = synthesis.informationGaps;
      allFindings.push(...synthesis.newFindings);

      if (synthesis.newFindings.length > 0) {
        this.emitUpdate('finding', {
          round: this.currentRound,
          findings: synthesis.newFindings,
        });
      }

      // Update confidence from successful responses
      const confidences = responses.filter(r => r.success).map(r => r.confidence).filter(c => typeof c === 'number');
      if (confidences.length > 0) {
        const avg = confidences.reduce((s, c) => s + c, 0) / confidences.length;
        stagedConfidence = Math.max(stagedConfidence, avg);
      }
      state.confidence = stagedConfidence;

      // 4. Extract focus intervals if this stage has an extractor
      if (stage.extractIntervals) {
        state.focusIntervals = stage.extractIntervals(responses, intervalHelpers);

        if (state.focusIntervals.length > 0) {
          // Set focused time range from highest-priority interval
          sharedContext.focusedTimeRange = {
            start: state.focusIntervals[0].startTs,
            end: state.focusIntervals[0].endTs,
          };
          this.emitUpdate('progress', {
            phase: 'progress',
            message: `已定位 ${state.focusIntervals.length} 个分析区间`,
          });
        }
      }

      // 5. Check early stop condition
      if (stage.shouldStop) {
        const stopResult = stage.shouldStop(state.focusIntervals);
        if (stopResult.stop) {
          this.stopReason = stopResult.reason;
          lastStrategy = this.concludeDecision(stagedConfidence, stopResult.reason);
          break;
        }
      }
    }

    // If all stages completed without early stop, mark as concluded
    if (!lastStrategy) {
      this.stopReason = `Strategy ${strategy.name} completed`;
      lastStrategy = this.concludeDecision(stagedConfidence, this.stopReason);
    }

    return { findings: allFindings, lastStrategy, confidence: stagedConfidence, informationGaps };
  }

  /**
   * Build concrete AgentTasks from a stage definition and current focus intervals.
   *
   * - scope: 'global' generates one task per template
   * - scope: 'per_interval' generates one task per (template x interval)
   */
  private buildStageTasks(
    stage: StageDefinition,
    focusIntervals: FocusInterval[],
    query: string,
    intent: Intent,
    sharedContext: SharedAgentContext,
    options: any
  ): AgentTask[] {
    const hypothesis = Array.from(sharedContext.hypotheses.values())
      .find(h => h.status === 'proposed' || h.status === 'investigating');
    const relevantFindings = sharedContext.confirmedFindings.slice(-5);
    const intentSummary = { primaryGoal: intent.primaryGoal, aspects: intent.aspects };

    const tasks: AgentTask[] = [];

    for (const template of stage.tasks) {
      const scopes = template.scope === 'global'
        ? [{ scopeLabel: '全局' as string }]
        : focusIntervals.map(interval => ({
            scopeLabel: interval.label || `区间${interval.id}`,
            timeRange: { start: interval.startTs, end: interval.endTs },
            packageName: interval.processName,
          }));

      for (const scope of scopes) {
        const description = template.descriptionTemplate
          .replace('{{scopeLabel}}', scope.scopeLabel);

        tasks.push({
          id: createTaskId(),
          description,
          targetAgentId: template.agentId,
          priority: template.priority || 5,
          context: {
            query,
            intent: intentSummary,
            hypothesis,
            domain: template.domain,
            ...('timeRange' in scope && { timeRange: scope.timeRange }),
            evidenceNeeded: template.evidenceNeeded || [],
            relevantFindings,
            additionalData: {
              traceProcessorService: options.traceProcessorService,
              packageName: ('packageName' in scope ? scope.packageName : undefined) || options.packageName,
              scopeLabel: scope.scopeLabel,
              ...(template.skillParams && { skillParams: template.skillParams }),
              ...(template.focusTools && { focusTools: template.focusTools }),
            },
          },
          dependencies: [],
          createdAt: Date.now(),
        });
      }
    }

    return tasks;
  }

  private normalizeDomain(domain: string): string {
    const normalized = domain.toLowerCase();
    return DOMAIN_ALIASES[normalized] || normalized;
  }

  private resolveAgentIdForDomain(domain: string, query: string): string | null {
    const agent = this.agentRegistry.getForDomain(domain);
    if (agent) return agent.config.id;

    // Direct match for agent IDs
    if (this.agentRegistry.get(domain)) {
      return domain;
    }

    const fallbackAgents = this.agentRegistry.getAgentsForTopic(query);
    return fallbackAgents.length > 0 ? fallbackAgents[0].config.id : null;
  }

  private parseTimeRange(
    input: any,
    options: any,
    sharedContext: SharedAgentContext
  ): { start: number | string; end: number | string } | undefined {
    if (input && typeof input === 'object') {
      const start = input.start;
      const end = input.end;
      if ((typeof start === 'number' || typeof start === 'string') &&
          (typeof end === 'number' || typeof end === 'string') &&
          start && end) {
        return { start, end };
      }
    }
    if (Array.isArray(input) && input.length >= 2) {
      const start = input[0];
      const end = input[1];
      if ((typeof start === 'number' || typeof start === 'string') &&
          (typeof end === 'number' || typeof end === 'string')) {
        return { start, end };
      }
    }
    if (sharedContext.focusedTimeRange) {
      return sharedContext.focusedTimeRange;
    }
    if (options?.timeRange) {
      return options.timeRange;
    }
    return undefined;
  }

  private async executeTaskGraph(tasks: AgentTask[]): Promise<AgentResponse[]> {
    const pending = new Map<string, AgentTask>(tasks.map(task => [task.id, task]));
    const completed = new Set<string>();
    const responses: AgentResponse[] = [];

    while (pending.size > 0) {
      const ready = Array.from(pending.values()).filter(task =>
        (task.dependencies || []).every(dep => completed.has(dep))
      );

      if (ready.length === 0) {
        // Avoid deadlock: execute remaining tasks without dependency gating
        const remaining = Array.from(pending.values());
        this.emitUpdate('progress', {
          phase: 'task_graph_stalled',
          pending: remaining.map(t => t.id),
          message: '任务依赖无法满足，继续执行剩余任务',
        });

        const fallbackResponses = await this.messageBus.dispatchTasksParallel(remaining);
        responses.push(...fallbackResponses);
        fallbackResponses.forEach(r => completed.add(r.taskId));
        pending.clear();
        break;
      }

      const batchResponses = await this.messageBus.dispatchTasksParallel(ready);
      responses.push(...batchResponses);
      batchResponses.forEach(r => completed.add(r.taskId));
      ready.forEach(task => pending.delete(task.id));
    }

    return responses;
  }

  private emitDataEnvelopes(responses: AgentResponse[]): void {
    const toolResultCounts = responses.map(r => ({
      agentId: r.agentId,
      toolResults: r.toolResults?.length || 0,
      envelopes: r.toolResults?.reduce((sum, tr) => sum + (tr.dataEnvelopes?.length || 0), 0) || 0,
    }));
    this.log(`emitDataEnvelopes: ${responses.length} responses, tool results: ${JSON.stringify(toolResultCounts)}`);

    const allEnvelopes = responses
      .flatMap(response => response.toolResults || [])
      .flatMap(result => result.dataEnvelopes || []);

    // Filter out envelopes with no data rows (empty tables add noise without value)
    const envelopes = allEnvelopes.filter(env => {
      const payload = env.data as any;
      if (!payload) return false;
      // Keep non-table formats (text, summary, chart, etc.)
      if (env.display.format !== 'table' && env.display.format !== undefined) return true;
      // For tables: require at least one row
      const rows = payload.rows;
      return rows && Array.isArray(rows) && rows.length > 0;
    });

    const filteredCount = allEnvelopes.length - envelopes.length;
    if (filteredCount > 0) {
      this.log(`Filtered out ${filteredCount} empty DataEnvelope(s)`);
    }

    if (envelopes.length > 0) {
      this.log(`Emitting ${envelopes.length} DataEnvelope(s): [${envelopes.map(e => e.meta?.source || 'unknown').join(', ')}]`);
      this.emitUpdate('data', envelopes);
    } else {
      this.log('No DataEnvelopes to emit (all responses had empty toolResults or no envelopes)');
    }
  }

  private evaluateEarlyStop(responses: AgentResponse[], newFindingsCount: number): boolean {
    const failedCount = responses.filter(r => !r.success).length;
    const failureRatio = responses.length > 0 ? failedCount / responses.length : 1;

    this.noProgressRounds = newFindingsCount === 0 ? this.noProgressRounds + 1 : 0;
    this.failureRounds = failureRatio > 0.6 ? this.failureRounds + 1 : 0;

    if (this.noProgressRounds >= this.config.maxNoProgressRounds) {
      this.stopReason = '连续多轮没有新增证据';
      return true;
    }

    if (this.failureRounds >= this.config.maxFailureRounds) {
      this.stopReason = '任务执行失败过多，提前终止';
      return true;
    }

    return false;
  }

  // ==========================================================================
  // Feedback Synthesis
  // ==========================================================================

  private async synthesizeFeedback(
    responses: AgentResponse[],
    sharedContext: SharedAgentContext
  ): Promise<{
    newFindings: Finding[];
    confirmedFindings: Finding[];
    updatedHypotheses: Hypothesis[];
    informationGaps: string[];
  }> {
    const allFindings: Finding[] = [];
    const newFindings: Finding[] = [];

    // Collect all findings
    for (const response of responses) {
      allFindings.push(...response.findings);
    }

    // Deduplicate findings
    const seenTitles = new Set<string>();
    for (const finding of allFindings) {
      if (!seenTitles.has(finding.title)) {
        seenTitles.add(finding.title);
        newFindings.push(finding);
      }
    }

    // Use AI to synthesize
    const prompt = `综合以下 Agent 反馈：

${responses.map(r => `[${r.agentId}]:
- 发现: ${r.findings.map(f => f.title).join(', ') || '无'}
- 置信度: ${r.confidence.toFixed(2)}
- 建议: ${r.suggestions?.join('; ') || '无'}`).join('\n\n')}

当前假设:
${Array.from(sharedContext.hypotheses.values()).map(h => `- ${h.description} (${h.status})`).join('\n')}

请分析：
1. 哪些发现相互印证？
2. 是否存在矛盾？
3. 哪些假设得到支持或被否定？
4. 还缺少什么信息？

请以 JSON 返回：
{
  "correlatedFindings": ["相互印证的发现"],
  "contradictions": ["矛盾"],
  "hypothesisUpdates": [{"hypothesisId": "id", "action": "support/reject", "reason": "原因"}],
  "informationGaps": ["缺失的信息"]
}`;

    let informationGaps: string[] = [];

    try {
      const response = await this.modelRouter.callWithFallback(prompt, 'evaluation');
      const jsonMatch = response.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        informationGaps = parsed.informationGaps || [];

        // Process hypothesis updates
        if (parsed.hypothesisUpdates) {
          for (const update of parsed.hypothesisUpdates) {
            const hypothesis = sharedContext.hypotheses.get(update.hypothesisId);
            if (hypothesis) {
              if (update.action === 'support') {
                hypothesis.confidence = Math.min(1, hypothesis.confidence + 0.1);
              } else if (update.action === 'reject') {
                hypothesis.status = 'rejected';
                hypothesis.confidence = 0;
              }
              hypothesis.updatedAt = Date.now();
            }
          }
        }
      }
    } catch (error) {
      this.log(`Failed to synthesize feedback: ${error}`);
    }

    return {
      newFindings,
      confirmedFindings: sharedContext.confirmedFindings,
      updatedHypotheses: Array.from(sharedContext.hypotheses.values()),
      informationGaps,
    };
  }

  // ==========================================================================
  // Conclusion Generation
  // ==========================================================================

  private async generateConclusion(
    sharedContext: SharedAgentContext,
    allFindings: Finding[],
    intent: Intent,
    stopReason?: string
  ): Promise<string> {
    const confirmedHypotheses = Array.from(sharedContext.hypotheses.values())
      .filter(h => h.status === 'confirmed' || h.confidence >= 0.7);

    const prompt = `基于以下分析结果生成诊断结论：

用户目标: ${intent.primaryGoal}
${stopReason ? `提前终止原因: ${stopReason}` : ''}

已确认的假设:
${confirmedHypotheses.map(h => `- ${h.description} (confidence: ${h.confidence.toFixed(2)})`).join('\n') || '无'}

发现的问题:
${allFindings.map(f => `- [${f.severity}] ${f.title}`).join('\n') || '无'}

调查路径:
${sharedContext.investigationPath.map(s => `${s.stepNumber}. [${s.agentId}] ${s.summary}`).join('\n')}

请生成:
1. 根因分析（最可能的原因）
2. 证据支撑（每个结论的依据）
3. 置信度评估

注意：不要给出优化建议，只需要指出问题所在。`;

    try {
      const response = await this.modelRouter.callWithFallback(prompt, 'synthesis');
      return response.response;
    } catch (error) {
      this.log(`Failed to generate conclusion: ${error}`);
    }

    // Fallback conclusion
    return this.generateSimpleConclusion(allFindings, stopReason);
  }

  private generateSimpleConclusion(findings: Finding[], stopReason?: string): string {
    const critical = findings.filter(f => f.severity === 'critical');
    const warnings = findings.filter(f => f.severity === 'warning');

    let conclusion = '## 分析结论\n\n';

    if (critical.length > 0) {
      conclusion += `### 严重问题 (${critical.length})\n`;
      for (const f of critical) {
        conclusion += `- **${f.title}**\n`;
      }
      conclusion += '\n';
    }

    if (warnings.length > 0) {
      conclusion += `### 需要关注 (${warnings.length})\n`;
      for (const f of warnings) {
        conclusion += `- ${f.title}\n`;
      }
      conclusion += '\n';
    }

    if (findings.length === 0) {
      conclusion += '未发现明显的性能问题。\n';
    }

    if (stopReason) {
      conclusion += `\n> 备注：分析提前结束（${stopReason}）。\n`;
    }

    return conclusion;
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  private buildEvaluation(findings: Finding[], sharedContext: SharedAgentContext): Evaluation {
    const criticalCount = findings.filter(f => f.severity === 'critical').length;
    const confirmedHypotheses = Array.from(sharedContext.hypotheses.values())
      .filter(h => h.status === 'confirmed').length;

    return {
      passed: findings.length > 0,
      qualityScore: Math.min(1, findings.length * 0.1 + confirmedHypotheses * 0.2),
      completenessScore: Math.min(1, findings.length * 0.15),
      contradictions: [],
      feedback: {
        strengths: findings.length > 0 ? ['发现了性能问题'] : [],
        weaknesses: [],
        missingAspects: [],
        improvementSuggestions: [],
        priorityActions: [],
      },
      needsImprovement: findings.length === 0,
      suggestedActions: [],
    };
  }

  private concludeDecision(confidence: number, reasoning: string): StrategyDecision {
    return { strategy: 'conclude', confidence, reasoning };
  }

  private translateStrategy(strategy: string): string {
    const translations: Record<string, string> = {
      'continue': '继续分析',
      'deep_dive': '深入分析',
      'pivot': '转向新方向',
      'conclude': '生成结论',
    };
    return translations[strategy] || strategy;
  }

  private setupEventForwarding(): void {
    this.messageBus.on('task_dispatched', (data) => {
      this.emitUpdate('progress', { phase: 'task_dispatched', ...data });
    });

    this.messageBus.on('task_completed', (data) => {
      this.emitUpdate('progress', { phase: 'task_completed', ...data });
    });

    this.messageBus.on('agent_question', (question) => {
      this.emitUpdate('progress', { phase: 'agent_question', ...question });
    });

    this.messageBus.on('broadcast', (message) => {
      this.emitUpdate('progress', { phase: 'broadcast', ...message });
    });
  }

  private emitUpdate(type: StreamingUpdate['type'], content: any): void {
    const update: StreamingUpdate = {
      type,
      content,
      timestamp: Date.now(),
    };

    this.emit('update', update);

    if (this.config.streamingCallback) {
      this.config.streamingCallback(update);
    }
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[AgentDrivenOrchestrator] ${message}`);
    }
  }

  /**
   * Reset orchestrator state
   */
  reset(): void {
    this.messageBus.reset();
    this.currentRound = 0;
    this.sessionContext = null;
  }
}

/**
 * Create an agent-driven orchestrator
 */
export function createAgentDrivenOrchestrator(
  modelRouter: ModelRouter,
  config?: Partial<AgentDrivenOrchestratorConfig>
): AgentDrivenOrchestrator {
  return new AgentDrivenOrchestrator(modelRouter, config);
}

export default AgentDrivenOrchestrator;
