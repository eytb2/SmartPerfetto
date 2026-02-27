import type {
  AnalysisResult,
  AgentRuntimeConfig,
  ExecutionContext,
} from '../../../agent/core/orchestratorTypes';
import {
  IncrementalAnalyzer,
} from '../../../agent/core/incrementalAnalyzer';
import { RuntimeExecutionFactory } from '../runtimeExecutionFactory';
import { RuntimeResultFinalizer } from '../runtimeResultFinalizer';
import { RuntimeUpdateBridge } from '../runtimeUpdateBridge';
import type { RuntimeModeHandler, RuntimeModeExecutionRequest, RuntimeMode } from '../runtimeModeContracts';

interface FollowUpModeHandlerDeps {
  runtimeConfig: AgentRuntimeConfig;
  executionFactory: RuntimeExecutionFactory;
  resultFinalizer: RuntimeResultFinalizer;
  incrementalAnalyzer: IncrementalAnalyzer;
  updateBridge: RuntimeUpdateBridge;
}

export class FollowUpModeHandler implements RuntimeModeHandler {
  private readonly runtimeConfig: AgentRuntimeConfig;
  private readonly executionFactory: RuntimeExecutionFactory;
  private readonly resultFinalizer: RuntimeResultFinalizer;
  private readonly incrementalAnalyzer: IncrementalAnalyzer;
  private readonly updateBridge: RuntimeUpdateBridge;

  constructor(deps: FollowUpModeHandlerDeps) {
    this.runtimeConfig = deps.runtimeConfig;
    this.executionFactory = deps.executionFactory;
    this.resultFinalizer = deps.resultFinalizer;
    this.incrementalAnalyzer = deps.incrementalAnalyzer;
    this.updateBridge = deps.updateBridge;
  }

  supports(mode: RuntimeMode): boolean {
    return mode === 'compare' || mode === 'extend' || mode === 'drill_down';
  }

  async execute(request: RuntimeModeExecutionRequest): Promise<AnalysisResult> {
    const { runtimeContext, query, sessionId, traceId } = request;
    const services = this.executionFactory.createExecutionServices();
    const emitter = this.updateBridge.createEmitter();
    const sharedContext = services.messageBus.createSharedContext(sessionId, traceId);

    const executionCtx: ExecutionContext = {
      query,
      sessionId,
      traceId,
      intent: runtimeContext.intent,
      initialHypotheses: [],
      sharedContext,
      options: runtimeContext.executionOptions,
      sessionContext: runtimeContext.sessionContext,
      config: this.runtimeConfig,
    };

    const executor = this.executionFactory.createFollowUpModeExecutor(runtimeContext, services);
    if (!executor) {
      return {
        sessionId,
        success: false,
        findings: [],
        hypotheses: [],
        conclusion: 'Unable to resolve drill-down execution target intervals',
        confidence: 0,
        rounds: 0,
        totalDurationMs: 0,
      };
    }

    const startTime = Date.now();
    const executorResult = await executor.execute(executionCtx, emitter);

    this.resultFinalizer.handleExecutorIntervention(sessionId, executorResult);
    this.resultFinalizer.applyEntityWriteback(runtimeContext.sessionContext, executorResult);

    if (executorResult.pausedForIntervention) {
      emitter.emitUpdate('progress', {
        phase: 'paused_for_intervention',
        message: '分析已暂停，等待用户决策后继续',
      });

      return {
        sessionId,
        success: true,
        findings: executorResult.findings,
        hypotheses: Array.from(sharedContext.hypotheses.values()),
        conclusion: '分析已暂停，等待用户决策后继续。',
        confidence: executorResult.confidence,
        rounds: executorResult.rounds,
        totalDurationMs: Date.now() - startTime,
        pausedForIntervention: true,
        interventionRequest: executorResult.interventionRequest,
      };
    }

    const previousFindings = runtimeContext.sessionContext.getAllFindings();
    const mergedFindings = runtimeContext.decisionContext.mode === 'extend'
      ? this.incrementalAnalyzer.mergeFindings(previousFindings, executorResult.findings)
      : executorResult.findings;

    const singleFrameDrillDown =
      runtimeContext.intent.followUpType === 'drill_down' &&
      (runtimeContext.intent.referencedEntities || []).filter(entity => entity.type === 'frame').length === 1;

    emitter.emitUpdate('progress', { phase: 'concluding', message: '生成分析结论' });

    return this.resultFinalizer.finalizeAnalysisResult({
      query,
      sessionId,
      intent: runtimeContext.intent,
      sessionContext: runtimeContext.sessionContext,
      sharedContext,
      emitter,
      executorResult,
      mergedFindings,
      startTime,
      singleFrameDrillDown,
      mode: runtimeContext.sessionContext.getAllTurns().length > 0 ? 'focused_answer' : 'initial_report',
      historyBudget: 600,
    });
  }
}
