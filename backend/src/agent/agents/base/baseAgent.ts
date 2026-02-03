/**
 * SmartPerfetto Base Agent
 *
 * Phase 2.1: Abstract base class for all AI domain agents
 *
 * This class provides the foundation for AI-driven domain agents that:
 * 1. Use Skills as tools through AI reasoning
 * 2. Can request information from other agents
 * 3. Build and verify hypotheses
 * 4. Generate evidence-backed findings
 *
 * The Think-Act-Reflect loop:
 * 1. Understand: Parse task and build understanding
 * 2. Plan: Decide which tools to use
 * 3. Execute: Run tools and collect results
 * 4. Reflect: Evaluate results and decide next steps
 * 5. Respond: Generate response with findings
 */

import { EventEmitter } from 'events';
import {
  AgentConfig,
  AgentTask,
  AgentTaskContext,
  AgentResponse,
  AgentTool,
  AgentToolContext,
  AgentToolResult,
  Hypothesis,
  HypothesisUpdate,
  Evidence,
  InterAgentQuestion,
  ReasoningStep,
  SharedAgentContext,
  createHypothesisId,
} from '../../types/agentProtocol';
import { Finding } from '../../types';
import { ModelRouter } from '../../core/modelRouter';
import { isPlainObject, isStringArray, LlmJsonSchema, parseLlmJson } from '../../../utils/llmJson';
import {
  SkillExecutor,
  createSkillExecutor,
  skillRegistry,
  ensureSkillRegistryInitialized,
  SkillExecutionResult,
} from '../../../services/skillEngine';

// =============================================================================
// Types
// =============================================================================

/**
 * Skill definition for lazy tool initialization in agents.
 * Agents declare which skills they use at construction time, but actual
 * tool creation is deferred to executeTask() when the async skill registry
 * is guaranteed to be initialized.
 */
export interface SkillDefinitionForAgent {
  skillId: string;
  toolName: string;
  description: string;
  category: AgentTool['category'];
}

/**
 * Understanding of a task
 */
export interface TaskUnderstanding {
  /** Main objective */
  objective: string;
  /** Key questions to answer */
  questions: string[];
  /** Relevant domain areas */
  relevantAreas: string[];
  /** Recommended tools to use */
  recommendedTools: string[];
  /** Constraints or requirements */
  constraints: string[];
  /** Confidence in understanding */
  confidence: number;
}

/**
 * Execution plan
 */
export interface ExecutionPlan {
  /** Sequence of tool calls */
  steps: ExecutionStep[];
  /** Expected outcomes */
  expectedOutcomes: string[];
  /** Estimated execution time */
  estimatedTimeMs: number;
  /** Plan confidence */
  confidence: number;
}

/**
 * Single execution step
 */
export interface ExecutionStep {
  stepNumber: number;
  toolName: string;
  params: Record<string, any>;
  purpose: string;
  dependsOn?: number[];
}

/**
 * Result of executing the plan
 */
export interface ExecutionResult {
  steps: ExecutionStepResult[];
  findings: Finding[];
  success: boolean;
  totalTimeMs: number;
}

/**
 * Result of a single execution step
 */
export interface ExecutionStepResult {
  stepNumber: number;
  toolName: string;
  result: AgentToolResult;
  observations: string[];
}

/**
 * Reflection on execution results
 */
export interface Reflection {
  /** What was learned */
  insights: string[];
  /** Whether objectives were met */
  objectivesMet: boolean;
  /** Confidence in findings */
  findingsConfidence: number;
  /** Gaps in analysis */
  gaps: string[];
  /** Suggested next steps */
  nextSteps: string[];
  /** Hypothesis updates */
  hypothesisUpdates: HypothesisUpdate[];
  /** Questions for other agents */
  questionsForOthers: InterAgentQuestion[];
}

// =============================================================================
// LLM JSON Schemas (Deterministic parsing)
// =============================================================================

type TaskUnderstandingPayload = Partial<TaskUnderstanding>;
const TASK_UNDERSTANDING_JSON_SCHEMA: LlmJsonSchema<TaskUnderstandingPayload> = {
  name: 'agent_task_understanding_json@1.0.0',
  validate: (value: unknown): value is TaskUnderstandingPayload => {
    if (!isPlainObject(value)) return false;
    if ((value as any).objective !== undefined && typeof (value as any).objective !== 'string') return false;
    if ((value as any).questions !== undefined && !isStringArray((value as any).questions)) return false;
    if ((value as any).relevantAreas !== undefined && !isStringArray((value as any).relevantAreas)) return false;
    if ((value as any).recommendedTools !== undefined && !isStringArray((value as any).recommendedTools)) return false;
    if ((value as any).constraints !== undefined && !isStringArray((value as any).constraints)) return false;
    const confidence = (value as any).confidence;
    if (confidence !== undefined && confidence !== null && typeof confidence !== 'number') return false;
    return true;
  },
};

type ExecutionPlanPayload = Partial<ExecutionPlan> & { steps?: Array<Record<string, any>> };
const EXECUTION_PLAN_JSON_SCHEMA: LlmJsonSchema<ExecutionPlanPayload> = {
  name: 'agent_execution_plan_json@1.0.0',
  validate: (value: unknown): value is ExecutionPlanPayload => {
    if (!isPlainObject(value)) return false;
    const steps = (value as any).steps;
    if (steps !== undefined && steps !== null && !Array.isArray(steps)) return false;
    const expectedOutcomes = (value as any).expectedOutcomes;
    if (expectedOutcomes !== undefined && expectedOutcomes !== null && !isStringArray(expectedOutcomes)) return false;
    const estimatedTimeMs = (value as any).estimatedTimeMs;
    if (estimatedTimeMs !== undefined && estimatedTimeMs !== null && typeof estimatedTimeMs !== 'number') return false;
    const confidence = (value as any).confidence;
    if (confidence !== undefined && confidence !== null && typeof confidence !== 'number') return false;
    return true;
  },
};

type ReflectionPayload = Partial<Reflection>;
const REFLECTION_JSON_SCHEMA: LlmJsonSchema<ReflectionPayload> = {
  name: 'agent_reflection_json@1.0.0',
  validate: (value: unknown): value is ReflectionPayload => {
    if (!isPlainObject(value)) return false;
    if ((value as any).insights !== undefined && !isStringArray((value as any).insights)) return false;
    const objectivesMet = (value as any).objectivesMet;
    if (objectivesMet !== undefined && objectivesMet !== null && typeof objectivesMet !== 'boolean') return false;
    const findingsConfidence = (value as any).findingsConfidence;
    if (findingsConfidence !== undefined && findingsConfidence !== null && typeof findingsConfidence !== 'number') return false;
    if ((value as any).gaps !== undefined && !isStringArray((value as any).gaps)) return false;
    if ((value as any).nextSteps !== undefined && !isStringArray((value as any).nextSteps)) return false;
    const hypothesisUpdates = (value as any).hypothesisUpdates;
    if (hypothesisUpdates !== undefined && hypothesisUpdates !== null && !Array.isArray(hypothesisUpdates)) return false;
    const questionsForOthers = (value as any).questionsForOthers;
    if (questionsForOthers !== undefined && questionsForOthers !== null && !Array.isArray(questionsForOthers)) return false;
    return true;
  },
};

// =============================================================================
// Base Agent Abstract Class
// =============================================================================

/**
 * Abstract base class for domain-specific AI agents
 *
 * Each domain agent (Frame, CPU, Memory, Binder, etc.) extends this class
 * and provides:
 * 1. Domain-specific tools (wrapped Skills)
 * 2. Domain-specific reasoning prompts
 * 3. Domain-specific hypothesis generation
 */
export abstract class BaseAgent extends EventEmitter {
  /** Agent configuration */
  readonly config: AgentConfig;
  /** Model router for LLM calls */
  protected modelRouter: ModelRouter;
  /** Available tools */
  protected tools: Map<string, AgentTool>;
  /** Skill definitions for lazy tool initialization */
  protected skillDefinitions: SkillDefinitionForAgent[] = [];
  /** Whether tools have been lazily loaded from skill definitions */
  private toolsLoaded: boolean = false;
  /** Cached SkillExecutor with registered skills */
  private skillExecutorCache:
    | {
        traceProcessorService: any;
        aiService: any;
        executor: SkillExecutor;
      }
    | null = null;
  /** Current shared context */
  protected sharedContext: SharedAgentContext | null = null;
  /** Reasoning trace */
  protected reasoningTrace: ReasoningStep[] = [];
  /** Current iteration */
  protected currentIteration: number = 0;

  constructor(config: AgentConfig, modelRouter: ModelRouter, skillDefs?: SkillDefinitionForAgent[]) {
    super();
    this.config = config;
    this.modelRouter = modelRouter;
    this.tools = new Map();

    // Register any tools already in config (non-skill tools)
    for (const tool of config.tools) {
      this.tools.set(tool.name, tool);
    }

    // Store skill definitions for lazy loading
    if (skillDefs) {
      this.skillDefinitions = skillDefs;
    }
  }

  // ==========================================================================
  // Abstract Methods - Must be implemented by domain agents
  // ==========================================================================

  /**
   * Build domain-specific system prompt for understanding
   */
  protected abstract buildUnderstandingPrompt(task: AgentTask): string;

  /**
   * Build domain-specific system prompt for planning
   */
  protected abstract buildPlanningPrompt(understanding: TaskUnderstanding, task: AgentTask): string;

  /**
   * Build domain-specific system prompt for reflection
   */
  protected abstract buildReflectionPrompt(result: ExecutionResult, task: AgentTask): string;

  /**
   * Generate domain-specific hypotheses based on findings
   */
  protected abstract generateHypotheses(findings: Finding[], task: AgentTask): Promise<Hypothesis[]>;

  /**
   * Get domain-specific tool recommendations (subclass override)
   */
  protected abstract getRecommendedTools(context: AgentTaskContext): string[];

  /**
   * Resolve tools for a task context.
   * Generic: if orchestrator specifies `additionalData.focusTools`, restricts to those tools.
   * Otherwise falls back to subclass's getRecommendedTools().
   * This allows any orchestrator to control agent tool selection without scenario-specific flags.
   */
  private resolveToolsForTask(context: AgentTaskContext): string[] {
    const focusTools = (context.additionalData as any)?.focusTools;
    if (Array.isArray(focusTools) && focusTools.length > 0) {
      // Only return focusTools that this agent actually has registered
      const validTools = focusTools.filter((t: string) => this.tools.has(t));
      if (validTools.length > 0) return validTools;
    }
    return this.getRecommendedTools(context);
  }

  // ==========================================================================
  // Core Agent Loop
  // ==========================================================================

  /**
   * Execute a task through the Think-Act-Reflect loop
   */
  async executeTask(task: AgentTask, sharedContext: SharedAgentContext): Promise<AgentResponse> {
    const startTime = Date.now();
    this.sharedContext = sharedContext;
    this.reasoningTrace = [];
    this.currentIteration = 0;

    // Ensure skill-based tools are loaded (lazy initialization)
    await this.ensureToolsLoaded();

    this.emit('task_started', { agentId: this.config.id, taskId: task.id });

    try {
      // 1. Understand the task
      this.addReasoningStep('observation', 'Analyzing task requirements');
      const understanding = await this.understand(task);
      this.emit('understanding_complete', { agentId: this.config.id, understanding });

      // 2. Plan execution
      this.addReasoningStep('analysis', 'Creating execution plan');
      const plan = await this.plan(understanding, task);
      this.emit('plan_created', { agentId: this.config.id, plan });

      // 3. Execute plan
      this.addReasoningStep('action', `Executing ${plan.steps.length} steps`);
      const result = await this.execute(plan, task);
      this.emit('execution_complete', { agentId: this.config.id, result });

      // 4. Reflect on results
      this.addReasoningStep('analysis', 'Reflecting on results');
      const reflection = await this.reflect(result, task);
      this.emit('reflection_complete', { agentId: this.config.id, reflection });

      // 5. Generate response
      const response = await this.respond(reflection, result, task, startTime);
      this.emit('task_completed', { agentId: this.config.id, response });

      return response;

    } catch (error: any) {
      this.emit('task_failed', { agentId: this.config.id, taskId: task.id, error: error.message });

      return {
        agentId: this.config.id,
        taskId: task.id,
        success: false,
        findings: [],
        confidence: 0,
        executionTimeMs: Date.now() - startTime,
        reasoning: this.reasoningTrace,
      };
    }
  }

  // ==========================================================================
  // Think-Act-Reflect Steps
  // ==========================================================================

  /**
   * Step 1: Understand the task
   */
  protected async understand(task: AgentTask): Promise<TaskUnderstanding> {
    const prompt = this.buildUnderstandingPrompt(task);

    const response = await this.modelRouter.callWithFallback(prompt, 'intent_understanding', {
      sessionId: this.sharedContext?.sessionId,
      traceId: this.sharedContext?.traceId,
      jsonMode: true,
      promptId: `agent.${this.config.id}.understand`,
      promptVersion: '1.0.0',
      contractVersion: TASK_UNDERSTANDING_JSON_SCHEMA.name,
    });

    try {
      const parsed = parseLlmJson<TaskUnderstandingPayload>(response.response, TASK_UNDERSTANDING_JSON_SCHEMA);
      return {
        objective: parsed.objective || task.description,
        questions: parsed.questions || [],
        relevantAreas: parsed.relevantAreas || [],
        recommendedTools: parsed.recommendedTools || this.resolveToolsForTask(task.context),
        constraints: parsed.constraints || [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
      };
    } catch (error) {
      console.warn(`[${this.config.id}] Failed to parse understanding response`);
    }

    // Fallback to basic understanding
    return {
      objective: task.description,
      questions: [],
      relevantAreas: [this.config.domain],
      recommendedTools: this.resolveToolsForTask(task.context),
      constraints: [],
      confidence: 0.5,
    };
  }

  /**
   * Step 2: Plan execution
   */
  protected async plan(understanding: TaskUnderstanding, task: AgentTask): Promise<ExecutionPlan> {
    const prompt = this.buildPlanningPrompt(understanding, task);

    const response = await this.modelRouter.callWithFallback(prompt, 'planning', {
      sessionId: this.sharedContext?.sessionId,
      traceId: this.sharedContext?.traceId,
      jsonMode: true,
      promptId: `agent.${this.config.id}.plan`,
      promptVersion: '1.0.0',
      contractVersion: EXECUTION_PLAN_JSON_SCHEMA.name,
    });

    try {
      const parsed = parseLlmJson<ExecutionPlanPayload>(response.response, EXECUTION_PLAN_JSON_SCHEMA);
      const plannedSteps = (parsed.steps || [])
        .map((s: any, i: number) => ({
          stepNumber: i + 1,
          toolName: s.toolName || s.tool,
          params: s.params || {},
          purpose: s.purpose || `Execute ${s.toolName || s.tool}`,
          // Note: dependsOn is intentionally stripped — domain agent tools are
          // independent analysis units. The LLM-generated dependencies cause
          // cascade failures when tool names are filtered out, as step numbers
          // get re-assigned but dependsOn values aren't updated.
        }))
        .filter((step: any) => step.toolName && this.tools.has(step.toolName));

      if (plannedSteps.length === 0) {
        const fallbackTools = understanding.recommendedTools.length > 0
          ? understanding.recommendedTools
          : this.resolveToolsForTask(task.context);
        return {
          steps: fallbackTools.map((toolName, i) => ({
            stepNumber: i + 1,
            toolName,
            params: {},
            purpose: `Execute ${toolName}`,
          })),
          expectedOutcomes: parsed.expectedOutcomes || [],
          estimatedTimeMs: typeof parsed.estimatedTimeMs === 'number' ? parsed.estimatedTimeMs : 30000,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        };
      }

      return {
        steps: plannedSteps.map((step: any, i: number) => ({
          ...step,
          stepNumber: i + 1,
        })),
        expectedOutcomes: parsed.expectedOutcomes || [],
        estimatedTimeMs: typeof parsed.estimatedTimeMs === 'number' ? parsed.estimatedTimeMs : 30000,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
      };
    } catch (error) {
      console.warn(`[${this.config.id}] Failed to parse planning response`);
    }

    // Fallback to using recommended tools
    return {
      steps: understanding.recommendedTools.map((toolName, i) => ({
        stepNumber: i + 1,
        toolName,
        params: {},
        purpose: `Execute ${toolName}`,
      })),
      expectedOutcomes: [`Analyze ${this.config.domain}`],
      estimatedTimeMs: 30000,
      confidence: 0.5,
    };
  }

  /**
   * Step 3: Execute the plan
   */
  protected async execute(plan: ExecutionPlan, task: AgentTask): Promise<ExecutionResult> {
    const stepResults: ExecutionStepResult[] = [];
    const allFindings: Finding[] = [];
    let anyStepSucceeded = false;

    // Build tool context
    const toolContext: AgentToolContext = {
      sessionId: this.sharedContext?.sessionId || '',
      traceId: this.sharedContext?.traceId || '',
      traceProcessorService: task.context.additionalData?.traceProcessorService,
      packageName: task.context.additionalData?.packageName,
      timeRange: task.context.timeRange,
      aiService: task.context.additionalData?.aiService,
      additionalContext: {
        ...(task.context.additionalData || {}),
        taskId: task.id,
        agentId: this.config.id,
      },
    };

    // Execute each step
    for (const step of plan.steps) {
      // Check dependencies
      if (step.dependsOn) {
        const pendingDeps = step.dependsOn.filter(dep =>
          !stepResults.find(r => r.stepNumber === dep && r.result.success)
        );
        if (pendingDeps.length > 0) {
          console.warn(`[${this.config.id}] Skipping step ${step.stepNumber} - dependencies not met`);
          continue;
        }
      }

      // Get tool
      const tool = this.tools.get(step.toolName);
      if (!tool) {
        console.warn(`[${this.config.id}] Tool not found: ${step.toolName}`);
        stepResults.push({
          stepNumber: step.stepNumber,
          toolName: step.toolName,
          result: { success: false, error: `Tool not found: ${step.toolName}`, executionTimeMs: 0 },
          observations: [`Tool ${step.toolName} not available`],
        });
        continue;
      }

      // Execute tool
      this.emit('tool_executing', { agentId: this.config.id, toolName: step.toolName, step: step.stepNumber });

      const result = await tool.execute(step.params, toolContext);

      this.emit('tool_completed', { agentId: this.config.id, toolName: step.toolName, success: result.success });

      // Collect findings
      if (result.findings) {
        allFindings.push(...result.findings);
      }

      // Generate observations
      const observations = this.generateObservations(result);

      stepResults.push({
        stepNumber: step.stepNumber,
        toolName: step.toolName,
        result,
        observations,
      });

      if (result.success) {
        anyStepSucceeded = true;
      }
    }

    // Agent execution succeeds if at least one tool returned data successfully.
    // Individual tool failures (e.g., missing tables) don't invalidate the whole analysis.
    const success = anyStepSucceeded || stepResults.length === 0;

    return {
      steps: stepResults,
      findings: allFindings,
      success,
      totalTimeMs: stepResults.reduce((sum, r) => sum + r.result.executionTimeMs, 0),
    };
  }

  /**
   * Step 4: Reflect on results
   */
  protected async reflect(result: ExecutionResult, task: AgentTask): Promise<Reflection> {
    const prompt = this.buildReflectionPrompt(result, task);

    const response = await this.modelRouter.callWithFallback(prompt, 'evaluation', {
      sessionId: this.sharedContext?.sessionId,
      traceId: this.sharedContext?.traceId,
      jsonMode: true,
      promptId: `agent.${this.config.id}.reflect`,
      promptVersion: '1.0.0',
      contractVersion: REFLECTION_JSON_SCHEMA.name,
    });

    try {
      const parsed = parseLlmJson<ReflectionPayload>(response.response, REFLECTION_JSON_SCHEMA);
      return {
        insights: parsed.insights || [],
        objectivesMet: parsed.objectivesMet ?? result.success,
        findingsConfidence: typeof parsed.findingsConfidence === 'number' ? parsed.findingsConfidence : 0.5,
        gaps: parsed.gaps || [],
        nextSteps: parsed.nextSteps || [],
        hypothesisUpdates: parsed.hypothesisUpdates || [],
        questionsForOthers: parsed.questionsForOthers || [],
      };
    } catch (error) {
      console.warn(`[${this.config.id}] Failed to parse reflection response`);
    }

    // Fallback reflection
    return {
      insights: result.steps.flatMap(s => s.observations),
      objectivesMet: result.success,
      findingsConfidence: result.success ? 0.6 : 0.3,
      gaps: [],
      nextSteps: [],
      hypothesisUpdates: [],
      questionsForOthers: [],
    };
  }

  /**
   * Step 5: Generate final response
   */
  protected async respond(
    reflection: Reflection,
    result: ExecutionResult,
    task: AgentTask,
    startTime: number
  ): Promise<AgentResponse> {
    // Generate hypotheses based on findings
    const hypotheses = await this.generateHypotheses(result.findings, task);

    // Convert hypotheses to updates
    const hypothesisUpdates: HypothesisUpdate[] = hypotheses.map(h => ({
      hypothesisId: h.id,
      action: 'support',
      newConfidence: h.confidence,
      reason: `Generated from ${this.config.id} analysis`,
    }));

    // Add reflection hypothesis updates
    hypothesisUpdates.push(...reflection.hypothesisUpdates);

    const questionsForAgents: InterAgentQuestion[] = (reflection.questionsForOthers || [])
      .map((q: any) => {
        // LLMs sometimes return strings or partial objects; normalize to InterAgentQuestion
        if (typeof q === 'string') {
          return {
            fromAgent: this.config.id,
            toAgent: 'system_admin',
            question: q,
            priority: 5,
          } as InterAgentQuestion;
        }

        if (!q || typeof q !== 'object') return null;

        const question = typeof q.question === 'string' ? q.question : undefined;
        if (!question) return null;

        const toAgent = typeof q.toAgent === 'string' ? q.toAgent : 'system_admin';
        const priority = typeof q.priority === 'number' ? q.priority : 5;
        const context = q.context && typeof q.context === 'object' ? q.context : undefined;

        return {
          fromAgent: this.config.id,
          toAgent,
          question,
          context,
          priority,
        } as InterAgentQuestion;
      })
      .filter(Boolean) as InterAgentQuestion[];

    return {
      agentId: this.config.id,
      taskId: task.id,
      success: result.success,
      findings: result.findings,
      hypothesisUpdates,
      questionsForAgents,
      suggestions: reflection.nextSteps,
      confidence: reflection.findingsConfidence,
      executionTimeMs: Date.now() - startTime,
      toolResults: result.steps.map(s => s.result),
      reasoning: this.reasoningTrace,
    };
  }

  // ==========================================================================
  // Lazy Tool Loading
  // ==========================================================================

  /**
   * Ensure skill-based tools are loaded.
   * Called at the start of executeTask() — by this time the skill registry
   * is guaranteed to be initialized (the orchestrator awaits it before dispatching).
   */
  protected async ensureToolsLoaded(): Promise<void> {
    if (this.toolsLoaded) return;
    if (this.skillDefinitions.length === 0) {
      this.toolsLoaded = true;
      return;
    }

    await ensureSkillRegistryInitialized();

    for (const skillDef of this.skillDefinitions) {
      if (this.tools.has(skillDef.toolName)) continue;

      const skill = skillRegistry.getSkill(skillDef.skillId);
      if (!skill) {
        console.warn(`[${this.config.id}] Skill not found after init: ${skillDef.skillId}`);
        continue;
      }

      const tool: AgentTool = {
        name: skillDef.toolName,
        description: skillDef.description,
        skillId: skillDef.skillId,
        category: skillDef.category,
        parameters: skill.inputs?.map((input: any) => ({
          name: input.name,
          type: input.type as any,
          required: input.required,
          description: input.description || input.name,
          default: input.default,
        })),
        execute: this.createSkillToolExecutor(skillDef.skillId, skillDef.category),
      };

      this.tools.set(tool.name, tool);
    }

    this.toolsLoaded = true;
    if (this.tools.size > 0) {
      console.log(`[${this.config.id}] Loaded ${this.tools.size} tools from skills`);
    }
  }

  /**
   * Create a tool executor function for a given skill ID.
   * Shared across all domain agents — eliminates code duplication.
   */
  protected createSkillToolExecutor(
    skillId: string,
    category: string
  ): (params: Record<string, any>, context: AgentToolContext) => Promise<AgentToolResult> {
    return async (params: Record<string, any>, context: AgentToolContext): Promise<AgentToolResult> => {
      const startTime = Date.now();

      try {
        if (!context.traceProcessorService) {
          return {
            success: false,
            error: 'TraceProcessorService not available',
            executionTimeMs: Date.now() - startTime,
          };
        }

        // SkillExecutor instances have their own registry; ensure skills are registered
        // before executing (otherwise every tool call will fail with "Skill not found").
        const executor = await this.getOrCreateSkillExecutor(
          context.traceProcessorService,
          context.aiService
        );

        const execParams: Record<string, any> = {
          ...params,
          package: context.packageName,
        };

        if (context.timeRange) {
          // Pass timestamps as strings to preserve precision for values > Number.MAX_SAFE_INTEGER.
          // SQL template substitution (${start_ts}) handles string values correctly.
          execParams.start_ts = String(context.timeRange.start);
          execParams.end_ts = String(context.timeRange.end);
        }

        // Generic skill params: orchestrators pass extra skill parameters via additionalContext.skillParams.
        // This allows controlling skill behavior without the baseAgent needing to know specific skill IDs.
        const additional = (context.additionalContext || {}) as Record<string, any>;
        if (additional.skillParams && typeof additional.skillParams === 'object') {
          for (const [key, val] of Object.entries(additional.skillParams)) {
            if (val !== undefined && val !== null) {
              execParams[key] = val;
            }
          }
        }

        const result = await executor.execute(skillId, context.traceId, execParams, {});

        const findings = this.extractFindingsFromResult(result, skillId, category);
        const data = this.extractDataFromResult(result);

        // Derive group: if a task has both a timeRange and a scopeLabel, it's part of a
        // multi-interval analysis and should be grouped by its interval.
        // This is generic — works for scrolling intervals, startup phases, ANR windows, etc.
        const scopeLabel = typeof additional.scopeLabel === 'string' ? additional.scopeLabel.trim() : '';
        const derivedGroup =
          (typeof additional.group === 'string' && additional.group)  // explicit override
            ? additional.group
            : (context.timeRange && scopeLabel)  // auto-derive from timeRange
              ? `interval_${String(context.timeRange.start)}`
              : undefined;

        const dataEnvelopes = SkillExecutor.toDataEnvelopes(result).map((env) => {
          const executionId =
            typeof additional.executionId === 'string' ? additional.executionId :
            typeof additional.taskId === 'string' ? additional.taskId :
            `${skillId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

          // Make envelope source unique per execution so frontend can render repeated analyses
          // (e.g., per-interval deep dives) without deduping them away.
          env.meta.source = `${env.meta.source}#${executionId}`;

          if (scopeLabel) {
            env.display.title = `${scopeLabel} · ${env.display.title}`;
          }

          // Assign group for frontend interval grouping
          if (derivedGroup) {
            env.display.group = derivedGroup;
          }

          // Grouped results are collapsible; collapse empty tables by default
          if (env.display.group) {
            env.display.collapsible = true;
            const payload = env.data as any;
            const rows = payload?.rows;
            if (!rows || !Array.isArray(rows) || rows.length === 0) {
              env.display.defaultCollapsed = true;
            }
          }

          return env;
        });

        console.log(`[${this.config.id}] Skill ${skillId} executed: success=${result.success}, displayResults=${result.displayResults?.length || 0}, dataEnvelopes=${dataEnvelopes.length}`);

        return {
          success: result.success,
          data,
          findings,
          dataEnvelopes: dataEnvelopes.length > 0 ? dataEnvelopes : undefined,
          error: result.error,
          executionTimeMs: Date.now() - startTime,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          executionTimeMs: Date.now() - startTime,
        };
      }
    };
  }

  private async getOrCreateSkillExecutor(traceProcessorService: any, aiService: any): Promise<SkillExecutor> {
    await ensureSkillRegistryInitialized();

    if (
      this.skillExecutorCache &&
      this.skillExecutorCache.traceProcessorService === traceProcessorService &&
      this.skillExecutorCache.aiService === aiService
    ) {
      return this.skillExecutorCache.executor;
    }

    const executor = createSkillExecutor(traceProcessorService, aiService);
    executor.registerSkills(skillRegistry.getAllSkills());

    this.skillExecutorCache = {
      traceProcessorService,
      aiService,
      executor,
    };

    return executor;
  }

  /**
   * Extract findings from skill execution result.
   * Subclasses can override for domain-specific extraction logic.
   */
  protected extractFindingsFromResult(result: SkillExecutionResult, skillId: string, category: string): Finding[] {
    const findings: Finding[] = [];
    if (result.diagnostics && result.diagnostics.length > 0) {
      for (const diag of result.diagnostics) {
        findings.push({
          id: `${skillId}_${Date.now()}_${findings.length}`,
          category,
          severity: diag.severity,
          title: diag.diagnosis,
          description: diag.suggestions?.join('; ') || diag.diagnosis,
          source: skillId,
          confidence: typeof diag.confidence === 'number' ? diag.confidence : 0.8,
          details: diag.evidence,
        });
      }
    }
    return findings;
  }

  /**
   * Extract data from skill execution result
   */
  protected extractDataFromResult(result: SkillExecutionResult): any {
    if (result.displayResults && result.displayResults.length > 0) {
      const data: Record<string, any> = {};
      for (const dr of result.displayResults) {
        data[dr.stepId] = dr.data;
      }
      return data;
    }
    if (result.rawResults) {
      const data: Record<string, any> = {};
      for (const [stepId, stepResult] of Object.entries(result.rawResults)) {
        data[stepId] = stepResult.data;
      }
      return data;
    }
    return null;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Add a step to the reasoning trace
   */
  protected addReasoningStep(type: ReasoningStep['type'], content: string, confidence: number = 0.8): void {
    this.reasoningTrace.push({
      step: this.reasoningTrace.length + 1,
      type,
      content,
      confidence,
      timestamp: Date.now(),
    });
  }

  /**
   * Generate observations from a tool result
   */
  protected generateObservations(result: AgentToolResult): string[] {
    const observations: string[] = [];

    if (!result.success) {
      observations.push(`Tool execution failed: ${result.error}`);
      return observations;
    }

    if (result.findings && result.findings.length > 0) {
      observations.push(`Found ${result.findings.length} issues`);
      const critical = result.findings.filter(f => f.severity === 'critical').length;
      if (critical > 0) {
        observations.push(`${critical} critical issues identified`);
      }
    }

    if (result.data) {
      if (typeof result.data === 'object') {
        const keys = Object.keys(result.data);
        if (keys.length > 0) {
          observations.push(`Returned data with ${keys.length} fields`);
        }
      }
    }

    return observations;
  }

  /**
   * Create a hypothesis
   */
  protected createHypothesis(
    description: string,
    confidence: number,
    supportingEvidence: Evidence[] = []
  ): Hypothesis {
    return {
      id: createHypothesisId(),
      description,
      confidence,
      status: 'proposed',
      supportingEvidence,
      contradictingEvidence: [],
      proposedBy: this.config.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Get tool by name
   */
  getTool(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tools
   */
  getAllTools(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool descriptions for LLM, including parameter info.
   * This helps the LLM understand that tools are self-contained (with built-in SQL)
   * and only need simple parameters to execute.
   */
  getToolDescriptionsForLLM(): string {
    if (this.tools.size > 0) {
      return this.getAllTools()
        .map(t => {
          let desc = `- ${t.name}: ${t.description}`;
          if (t.parameters && t.parameters.length > 0) {
            const paramList = t.parameters
              .map(p => `${p.name}(${p.type}${p.required ? ',必填' : ''})`)
              .join(', ');
            desc += `\n  参数: [${paramList}]`;
          } else {
            desc += `\n  参数: 无（自动从上下文获取 package/start_ts/end_ts）`;
          }
          return desc;
        })
        .join('\n');
    }
    // Fallback: use skill definitions even before tools are loaded
    if (this.skillDefinitions.length > 0) {
      return this.skillDefinitions
        .map(s => `- ${s.toolName}: ${s.description}`)
        .join('\n');
    }
    return '（无可用工具）';
  }

  /**
   * Get the full "available tools" section for LLM prompts.
   * Includes tool list, parameter info, usage clarification, and negative examples.
   * Use this in buildUnderstandingPrompt / buildPlanningPrompt instead of raw getToolDescriptionsForLLM().
   */
  protected getToolSectionForPrompt(): string {
    return `## 可用工具（只能使用以下工具）
${this.getToolDescriptionsForLLM()}

## 工具使用规则

### ✅ 正确做法
- 只使用上方列表中的工具名称
- params 留空 {} 使用默认行为（package/start_ts/end_ts 自动注入）
- 如需指定可选参数，只填写工具文档中列出的参数

### ❌ 禁止行为（会导致执行失败）
- 使用未列出的工具名（如 analyze_gpu、check_memory 等不存在的工具）
- 在 params 中写 SQL 查询（工具已内置 SQL）
- 在 params 中填写 package/start_ts/end_ts（这些会自动注入）
- 猜测工具名称或参数名称
- 使用自然语言描述代替工具调用

### ADB 工具特殊说明
- adb_* 工具用于通过 ADB 获取设备信息/执行操作
- 默认只读模式，除非 mode=full 否则不要尝试改变设备状态
- 使用前先调用 adb_status 确认 enabled/selectedSerial`;
  }

  /**
   * Format common task context fields for prompts
   */
  protected formatTaskContext(task: AgentTask): string {
    const lines: string[] = [];
    if (task.context.domain) {
      lines.push(`- 任务领域: ${task.context.domain}`);
    }
    const adbContext = (task.context.additionalData as any)?.adbContext;
    if (adbContext && typeof adbContext === 'object') {
      const mode = adbContext.mode ?? 'auto';
      const enabled = adbContext.enabled ? 'true' : 'false';
      const selected = adbContext?.availability?.selectedSerial || 'none';
      const matchStatus = adbContext?.traceMatch?.status || 'unknown';
      const matchConfidence = typeof adbContext?.traceMatch?.confidence === 'number'
        ? adbContext.traceMatch.confidence.toFixed(2)
        : 'n/a';
      lines.push(`- ADB 协同: mode=${mode}, enabled=${enabled}, serial=${selected}, match=${matchStatus}(${matchConfidence})`);
    }
    if (task.context.timeRange) {
      lines.push(`- 时间范围: ${task.context.timeRange.start} ~ ${task.context.timeRange.end}`);
    }
    if (task.context.evidenceNeeded && task.context.evidenceNeeded.length > 0) {
      lines.push(`- 需输出证据: ${task.context.evidenceNeeded.join(', ')}`);
    }
    return lines.length > 0 ? lines.join('\n') : '';
  }

  /**
   * Set shared context
   */
  setSharedContext(context: SharedAgentContext): void {
    this.sharedContext = context;
  }
}

export default BaseAgent;
