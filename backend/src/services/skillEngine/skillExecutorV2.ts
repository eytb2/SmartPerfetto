/**
 * Skill Executor v2.0
 *
 * 核心执行引擎，支持：
 * - Skill 组合（composite）
 * - Skill 迭代（iterator）
 * - AI 协作（ai_decision, ai_summary）
 * - 诊断推理（diagnostic）
 * - 展示控制（display）
 */

import {
  SkillDefinitionV2,
  SkillStep,
  AtomicStep,
  SkillRefStep,
  IteratorStep,
  ParallelStep,
  DiagnosticStep,
  AIDecisionStep,
  AISummaryStep,
  ConditionalStep,
  SkillExecutionContextV2,
  SkillExecutionResultV2,
  StepResult,
  DisplayResult,
  DiagnosticResult,
  DisplayConfig,
  DisplayLevel,
  SkillEvent,
} from './types_v2';

// =============================================================================
// 表达式求值器
// =============================================================================

class ExpressionEvaluator {
  /**
   * 在上下文中求值表达式
   * 支持：${variable}、${step.field}、比较运算符等
   */
  static evaluate(expression: string, context: SkillExecutionContextV2): any {
    // 替换变量引用
    let result = expression;

    // 替换 ${xxx} 格式的变量
    result = result.replace(/\$\{([^}]+)\}/g, (match, path) => {
      const value = this.resolvePath(path, context);
      if (value === undefined) return match;
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });

    // 如果是简单的比较表达式，尝试求值
    if (/^[\d\.\s\+\-\*\/\>\<\=\!\&\|]+$/.test(result)) {
      try {
        // 安全地执行简单数学/比较表达式
        return new Function(`return ${result}`)();
      } catch {
        return result;
      }
    }

    return result;
  }

  /**
   * 解析路径引用，如 "step1.field1" 或 "item.ts"
   */
  static resolvePath(path: string, context: SkillExecutionContextV2): any {
    const parts = path.split('.');

    // 尝试从不同来源解析
    // 1. 当前迭代项
    if (parts[0] === 'item' && context.currentItem) {
      return parts.length === 1 ? context.currentItem : context.currentItem[parts[1]];
    }

    // 2. 参数
    if (context.params[parts[0]] !== undefined) {
      const value = context.params[parts[0]];
      return parts.length === 1 ? value : value?.[parts[1]];
    }

    // 3. 继承的上下文
    if (context.inherited[parts[0]] !== undefined) {
      const value = context.inherited[parts[0]];
      return parts.length === 1 ? value : value?.[parts[1]];
    }

    // 4. 变量（save_as 保存的）
    if (context.variables[parts[0]] !== undefined) {
      const value = context.variables[parts[0]];
      if (parts.length === 1) return value;
      // 如果是数组，取第一个元素的字段
      if (Array.isArray(value) && value.length > 0) {
        return value[0][parts[1]];
      }
      return value?.[parts[1]];
    }

    // 5. 步骤结果
    if (context.results[parts[0]]) {
      const stepResult = context.results[parts[0]];
      if (parts.length === 1) return stepResult.data;
      return stepResult.data?.[parts[1]];
    }

    return undefined;
  }

  /**
   * 评估条件表达式，返回 boolean
   */
  static evaluateCondition(condition: string, context: SkillExecutionContextV2): boolean {
    const result = this.evaluate(condition, context);
    return Boolean(result);
  }
}

// =============================================================================
// SQL 变量替换
// =============================================================================

function substituteVariables(sql: string, context: SkillExecutionContextV2): string {
  let result = sql;

  // 替换所有 ${xxx} 格式的变量
  result = result.replace(/\$\{([^}]+)\}/g, (match, path) => {
    const value = ExpressionEvaluator.resolvePath(path, context);
    if (value === undefined) {
      console.warn(`[SkillExecutorV2] Variable not found: ${path}`);
      return match;
    }
    return String(value);
  });

  return result;
}

// =============================================================================
// Skill Executor V2
// =============================================================================

export class SkillExecutorV2 {
  private traceProcessor: any;
  private aiService: any;  // AI 服务（用于 ai_decision, ai_summary）
  private skillRegistry: Map<string, SkillDefinitionV2>;
  private eventEmitter?: (event: SkillEvent) => void;

  constructor(
    traceProcessor: any,
    aiService?: any,
    eventEmitter?: (event: SkillEvent) => void
  ) {
    this.traceProcessor = traceProcessor;
    this.aiService = aiService;
    this.eventEmitter = eventEmitter;
    this.skillRegistry = new Map();
  }

  /**
   * 注册 skill
   */
  registerSkill(skill: SkillDefinitionV2): void {
    this.skillRegistry.set(skill.name, skill);
  }

  /**
   * 批量注册 skills
   */
  registerSkills(skills: SkillDefinitionV2[]): void {
    for (const skill of skills) {
      this.registerSkill(skill);
    }
  }

  /**
   * 发送事件到前端
   */
  private emit(event: Omit<SkillEvent, 'timestamp'>): void {
    if (this.eventEmitter) {
      this.eventEmitter({
        ...event,
        timestamp: Date.now(),
      } as SkillEvent);
    }
  }

  /**
   * 执行 skill
   */
  async execute(
    skillId: string,
    traceId: string,
    params: Record<string, any> = {},
    inherited: Record<string, any> = {}
  ): Promise<SkillExecutionResultV2> {
    const startTime = Date.now();

    const skill = this.skillRegistry.get(skillId);
    if (!skill) {
      return {
        skillId,
        skillName: skillId,
        success: false,
        displayResults: [],
        diagnostics: [],
        executionTimeMs: Date.now() - startTime,
        error: `Skill not found: ${skillId}`,
      };
    }

    this.emit({
      type: 'skill_started',
      skillId,
      data: { skillName: skill.meta.display_name },
    });

    // 创建执行上下文
    const context: SkillExecutionContextV2 = {
      traceId,
      params,
      inherited,
      results: {},
      variables: {},
    };

    // 加载必要的模块
    if (skill.prerequisites?.modules) {
      for (const module of skill.prerequisites.modules) {
        try {
          await this.traceProcessor.query(traceId, `INCLUDE PERFETTO MODULE ${module};`);
        } catch (e: any) {
          console.warn(`[SkillExecutorV2] Module not available: ${module}`);
        }
      }
    }

    try {
      const displayResults: DisplayResult[] = [];
      const diagnostics: DiagnosticResult[] = [];
      let aiSummary: string | undefined;

      // 根据 skill 类型执行
      switch (skill.type) {
        case 'atomic':
          const atomicResult = await this.executeAtomicSkill(skill, context);
          if (atomicResult.display) {
            displayResults.push(this.createDisplayResult('root', skill.meta.display_name, atomicResult, skill.output?.display));
          }
          break;

        case 'composite':
        case 'iterator':
        case 'diagnostic':
          if (skill.steps) {
            for (const step of skill.steps) {
              const stepResult = await this.executeStep(step, context, skillId);

              if (stepResult.success) {
                // 保存结果
                context.results[step.id] = stepResult;

                // 如果有 save_as，保存到变量
                if ('save_as' in step && step.save_as) {
                  context.variables[step.save_as] = stepResult.data;
                }

                // 收集需要展示的结果
                if (this.shouldDisplay(step)) {
                  displayResults.push(this.createDisplayResult(
                    step.id,
                    ('name' in step ? step.name : step.id) || step.id,
                    stepResult,
                    this.getDisplayConfig(step)
                  ));
                }

                // 收集诊断结果
                if (step.type === 'diagnostic' && stepResult.data?.diagnostics) {
                  diagnostics.push(...stepResult.data.diagnostics);
                }

                // 收集 AI 总结
                if (step.type === 'ai_summary' && stepResult.data?.summary) {
                  aiSummary = stepResult.data.summary;
                }
              }
            }
          }
          break;
      }

      this.emit({
        type: 'skill_completed',
        skillId,
        data: {
          success: true,
          displayResultsCount: displayResults.length,
          diagnosticsCount: diagnostics.length,
        },
      });

      return {
        skillId,
        skillName: skill.meta.display_name,
        success: true,
        displayResults,
        diagnostics,
        aiSummary,
        rawResults: context.results,
        executionTimeMs: Date.now() - startTime,
      };

    } catch (error: any) {
      this.emit({
        type: 'skill_error',
        skillId,
        data: { error: error.message },
      });

      return {
        skillId,
        skillName: skill.meta.display_name,
        success: false,
        displayResults: [],
        diagnostics: [],
        executionTimeMs: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * 执行原子 skill（单个 SQL）
   */
  private async executeAtomicSkill(
    skill: SkillDefinitionV2,
    context: SkillExecutionContextV2
  ): Promise<StepResult> {
    const startTime = Date.now();

    if (!skill.sql) {
      return {
        stepId: 'root',
        stepType: 'atomic',
        success: false,
        error: 'No SQL defined for atomic skill',
        executionTimeMs: Date.now() - startTime,
      };
    }

    const sql = substituteVariables(skill.sql, context);

    try {
      const result = await this.traceProcessor.query(context.traceId, sql);

      if (result.error) {
        return {
          stepId: 'root',
          stepType: 'atomic',
          success: false,
          error: result.error,
          executionTimeMs: Date.now() - startTime,
        };
      }

      return {
        stepId: 'root',
        stepType: 'atomic',
        success: true,
        data: this.rowsToObjects(result.columns, result.rows),
        executionTimeMs: Date.now() - startTime,
        display: skill.output?.display,
      };

    } catch (error: any) {
      return {
        stepId: 'root',
        stepType: 'atomic',
        success: false,
        error: error.message,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    step: SkillStep,
    context: SkillExecutionContextV2,
    parentSkillId: string
  ): Promise<StepResult> {
    const startTime = Date.now();

    this.emit({
      type: 'step_started',
      skillId: parentSkillId,
      stepId: step.id,
      data: { stepType: step.type },
    });

    let result: StepResult;

    try {
      switch (step.type) {
        case 'atomic':
          result = await this.executeAtomicStep(step, context);
          break;

        case 'iterator':
          result = await this.executeIteratorStep(step, context, parentSkillId);
          break;

        case 'parallel':
          result = await this.executeParallelStep(step, context, parentSkillId);
          break;

        case 'diagnostic':
          result = await this.executeDiagnosticStep(step, context);
          break;

        case 'ai_decision':
          result = await this.executeAIDecisionStep(step, context);
          break;

        case 'ai_summary':
          result = await this.executeAISummaryStep(step, context);
          break;

        case 'conditional':
          result = await this.executeConditionalStep(step, context, parentSkillId);
          break;

        default:
          // 默认作为 skill 引用处理
          const unknownStep = step as SkillStep;
          if ('skill' in unknownStep) {
            result = await this.executeSkillRefStep(unknownStep as SkillRefStep, context);
          } else {
            result = {
              stepId: unknownStep.id,
              stepType: 'atomic',
              success: false,
              error: `Unknown step type: ${(unknownStep as any).type}`,
              executionTimeMs: Date.now() - startTime,
            };
          }
      }
    } catch (error: any) {
      const failedStep = step as SkillStep;
      result = {
        stepId: failedStep.id,
        stepType: failedStep.type || 'skill',
        success: false,
        error: error.message,
        executionTimeMs: Date.now() - startTime,
      };
    }

    this.emit({
      type: 'step_completed',
      skillId: parentSkillId,
      stepId: step.id,
      data: { success: result.success, error: result.error },
    });

    return result;
  }

  /**
   * 执行原子步骤
   */
  private async executeAtomicStep(
    step: AtomicStep,
    context: SkillExecutionContextV2
  ): Promise<StepResult> {
    const startTime = Date.now();
    const sql = substituteVariables(step.sql, context);

    console.log(`[SkillExecutorV2] Executing atomic step: ${step.id}`);
    console.log(`[SkillExecutorV2] SQL: ${sql.substring(0, 200)}...`);

    try {
      const result = await this.traceProcessor.query(context.traceId, sql);

      if (result.error) {
        if (step.optional) {
          return {
            stepId: step.id,
            stepType: 'atomic',
            success: true,
            data: [],
            executionTimeMs: Date.now() - startTime,
          };
        }
        return {
          stepId: step.id,
          stepType: 'atomic',
          success: false,
          error: result.error,
          executionTimeMs: Date.now() - startTime,
        };
      }

      const data = this.rowsToObjects(result.columns, result.rows);
      console.log(`[SkillExecutorV2] Step ${step.id} returned ${data.length} rows`);

      return {
        stepId: step.id,
        stepType: 'atomic',
        success: true,
        data,
        executionTimeMs: Date.now() - startTime,
      };

    } catch (error: any) {
      if (step.optional) {
        return {
          stepId: step.id,
          stepType: 'atomic',
          success: true,
          data: [],
          executionTimeMs: Date.now() - startTime,
        };
      }
      throw error;
    }
  }

  /**
   * 执行 skill 引用步骤
   */
  private async executeSkillRefStep(
    step: SkillRefStep,
    context: SkillExecutionContextV2
  ): Promise<StepResult> {
    const startTime = Date.now();

    // 构建子 skill 的参数
    const params: Record<string, any> = {};
    if (step.params) {
      for (const [key, value] of Object.entries(step.params)) {
        if (typeof value === 'string' && value.startsWith('${')) {
          params[key] = ExpressionEvaluator.evaluate(value, context);
        } else {
          params[key] = value;
        }
      }
    }

    // 执行子 skill
    const result = await this.execute(
      step.skill,
      context.traceId,
      params,
      { ...context.inherited, ...context.variables }
    );

    return {
      stepId: step.id,
      stepType: 'skill',
      success: result.success,
      data: result,
      error: result.error,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * 执行迭代步骤
   */
  private async executeIteratorStep(
    step: IteratorStep,
    context: SkillExecutionContextV2,
    parentSkillId: string
  ): Promise<StepResult> {
    const startTime = Date.now();

    // 获取数据源
    const source = context.variables[step.source] || context.results[step.source]?.data;
    if (!source || !Array.isArray(source)) {
      return {
        stepId: step.id,
        stepType: 'iterator',
        success: false,
        error: `Iterator source not found or not an array: ${step.source}`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    console.log(`[SkillExecutorV2] Iterator step ${step.id}: ${source.length} items`);

    const results: any[] = [];
    const maxItems = step.max_items || 100;  // 性能保护
    const items = source.slice(0, maxItems);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // 构建子 skill 的参数
      const params: Record<string, any> = {};
      if (step.item_params) {
        for (const [key, path] of Object.entries(step.item_params)) {
          params[key] = item[path] ?? path;
        }
      } else {
        // 默认将 item 的所有字段作为参数
        Object.assign(params, item);
      }

      // 设置当前迭代项
      const iterContext = { ...context };
      iterContext.currentItem = item;
      iterContext.currentItemIndex = i;

      // 执行子 skill
      const itemResult = await this.execute(
        step.item_skill,
        context.traceId,
        params,
        { ...context.inherited, ...context.variables, item }
      );

      if (itemResult.success) {
        results.push({
          itemIndex: i,
          item,
          result: itemResult,
        });
      }
    }

    return {
      stepId: step.id,
      stepType: 'iterator',
      success: true,
      data: results,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * 执行并行步骤
   */
  private async executeParallelStep(
    step: ParallelStep,
    context: SkillExecutionContextV2,
    parentSkillId: string
  ): Promise<StepResult> {
    const startTime = Date.now();

    const promises = step.steps.map(subStep =>
      this.executeStep(subStep, context, parentSkillId)
    );

    const results = await Promise.all(promises);
    const allSuccess = results.every(r => r.success);

    // 将结果存入 context
    const data: Record<string, any> = {};
    for (let i = 0; i < step.steps.length; i++) {
      const subStep = step.steps[i];
      data[subStep.id] = results[i].data;
      context.results[subStep.id] = results[i];
    }

    return {
      stepId: step.id,
      stepType: 'parallel',
      success: allSuccess,
      data,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * 执行诊断步骤
   */
  private async executeDiagnosticStep(
    step: DiagnosticStep,
    context: SkillExecutionContextV2
  ): Promise<StepResult> {
    const startTime = Date.now();
    const diagnostics: DiagnosticResult[] = [];

    // 收集输入数据
    const inputs: Record<string, any> = {};
    for (const inputName of step.inputs) {
      inputs[inputName] = context.variables[inputName] || context.results[inputName]?.data;
    }

    // 评估规则
    for (const rule of step.rules) {
      const conditionResult = ExpressionEvaluator.evaluateCondition(rule.condition, context);

      if (conditionResult) {
        const confidence = typeof rule.confidence === 'number'
          ? rule.confidence
          : rule.confidence === 'high' ? 0.9 : rule.confidence === 'medium' ? 0.7 : 0.5;

        diagnostics.push({
          id: `${step.id}_${diagnostics.length}`,
          diagnosis: rule.diagnosis,
          confidence,
          severity: confidence >= 0.8 ? 'critical' : confidence >= 0.6 ? 'warning' : 'info',
          suggestions: rule.suggestions,
          source: 'rule',
        });
      }
    }

    // 如果没有匹配的规则且配置了 AI 辅助，调用 AI
    if (diagnostics.length === 0 && step.ai_assist && step.fallback && this.aiService) {
      const aiResult = await this.callAI(step.fallback.prompt, context);
      if (aiResult) {
        diagnostics.push({
          id: `${step.id}_ai`,
          diagnosis: aiResult,
          confidence: 0.6,
          severity: 'info',
          source: 'ai',
        });
      }
    }

    return {
      stepId: step.id,
      stepType: 'diagnostic',
      success: true,
      data: { diagnostics, inputs },
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * 执行 AI 决策步骤
   */
  private async executeAIDecisionStep(
    step: AIDecisionStep,
    context: SkillExecutionContextV2
  ): Promise<StepResult> {
    const startTime = Date.now();

    if (!this.aiService) {
      return {
        stepId: step.id,
        stepType: 'ai_decision',
        success: false,
        error: 'AI service not available',
        executionTimeMs: Date.now() - startTime,
      };
    }

    const prompt = ExpressionEvaluator.evaluate(step.prompt, context);

    this.emit({
      type: 'ai_thinking',
      skillId: '',
      stepId: step.id,
      data: { prompt },
    });

    const response = await this.callAI(prompt, context);

    this.emit({
      type: 'ai_response',
      skillId: '',
      stepId: step.id,
      data: { response },
    });

    return {
      stepId: step.id,
      stepType: 'ai_decision',
      success: true,
      data: { decision: response },
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * 执行 AI 总结步骤
   */
  private async executeAISummaryStep(
    step: AISummaryStep,
    context: SkillExecutionContextV2
  ): Promise<StepResult> {
    const startTime = Date.now();

    if (!this.aiService) {
      return {
        stepId: step.id,
        stepType: 'ai_summary',
        success: false,
        error: 'AI service not available',
        executionTimeMs: Date.now() - startTime,
      };
    }

    const prompt = ExpressionEvaluator.evaluate(step.prompt, context);

    this.emit({
      type: 'ai_thinking',
      skillId: '',
      stepId: step.id,
      data: { prompt },
    });

    const response = await this.callAI(prompt, context);

    this.emit({
      type: 'ai_response',
      skillId: '',
      stepId: step.id,
      data: { response },
    });

    return {
      stepId: step.id,
      stepType: 'ai_summary',
      success: true,
      data: { summary: response },
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * 执行条件步骤
   */
  private async executeConditionalStep(
    step: ConditionalStep,
    context: SkillExecutionContextV2,
    parentSkillId: string
  ): Promise<StepResult> {
    const startTime = Date.now();

    // 评估条件
    for (const condition of step.conditions) {
      if (ExpressionEvaluator.evaluateCondition(condition.when, context)) {
        if (typeof condition.then === 'string') {
          // skill 引用
          return this.executeSkillRefStep({
            id: step.id,
            skill: condition.then,
          }, context);
        } else {
          // 内联步骤
          return this.executeStep(condition.then, context, parentSkillId);
        }
      }
    }

    // 默认分支
    if (step.else) {
      if (typeof step.else === 'string') {
        return this.executeSkillRefStep({
          id: step.id,
          skill: step.else,
        }, context);
      } else {
        return this.executeStep(step.else, context, parentSkillId);
      }
    }

    return {
      stepId: step.id,
      stepType: 'conditional',
      success: true,
      data: null,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * 调用 AI 服务
   */
  private async callAI(prompt: string, context: SkillExecutionContextV2): Promise<string> {
    if (!this.aiService) {
      return '';
    }

    try {
      // TODO: 实现实际的 AI 调用
      const response = await this.aiService.chat(prompt);
      return response;
    } catch (error: any) {
      console.error('[SkillExecutorV2] AI call failed:', error.message);
      return '';
    }
  }

  /**
   * 判断步骤是否需要展示
   */
  private shouldDisplay(step: SkillStep): boolean {
    if (!('display' in step)) return false;
    const display = step.display;
    if (display === false) return false;
    if (display === true) return true;
    if (typeof display === 'object') {
      return display.show !== false && display.level !== 'none';
    }
    return false;
  }

  /**
   * 获取步骤的展示配置
   */
  private getDisplayConfig(step: SkillStep): DisplayConfig | undefined {
    if (!('display' in step)) return undefined;
    const display = step.display;
    if (typeof display === 'boolean') {
      return display ? { show: true, level: 'summary' } : undefined;
    }
    return display;
  }

  /**
   * 创建展示结果
   */
  private createDisplayResult(
    stepId: string,
    title: string,
    stepResult: StepResult,
    displayConfig?: DisplayConfig
  ): DisplayResult {
    const config = displayConfig || { level: 'summary', format: 'table' };
    const data = stepResult.data;

    // 根据数据类型确定展示格式
    let displayData: DisplayResult['data'];

    if (Array.isArray(data) && data.length > 0) {
      const columns = Object.keys(data[0]);
      const rows = data.map(row => columns.map(col => row[col]));
      displayData = { columns, rows };
    } else if (typeof data === 'string') {
      displayData = { text: data };
    } else {
      displayData = { text: JSON.stringify(data, null, 2) };
    }

    return {
      stepId,
      title: config.title || title,
      level: config.level || 'summary',
      format: config.format || 'table',
      data: displayData,
      highlight: config.highlight,
    };
  }

  /**
   * 将行数组转换为对象数组
   */
  private rowsToObjects(columns: string[], rows: any[][]): Record<string, any>[] {
    return rows.map(row => {
      const obj: Record<string, any> = {};
      columns.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      return obj;
    });
  }
}

// =============================================================================
// 工厂函数
// =============================================================================

export function createSkillExecutorV2(
  traceProcessor: any,
  aiService?: any,
  eventEmitter?: (event: SkillEvent) => void
): SkillExecutorV2 {
  return new SkillExecutorV2(traceProcessor, aiService, eventEmitter);
}
