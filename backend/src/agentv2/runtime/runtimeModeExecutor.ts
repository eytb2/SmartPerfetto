import type {
  AnalysisResult,
  AgentRuntimeConfig,
} from '../../agent/core/orchestratorTypes';
import {
  IncrementalAnalyzer,
} from '../../agent/core/incrementalAnalyzer';
import type { FocusStore } from '../../agent/context/focusStore';
import { ModelRouter } from '../../agent/core/modelRouter';
import type { DomainAgentRegistry } from '../../agent/agents/domain';
import type { IterationStrategyPlanner } from '../../agent/agents/iterationStrategyPlanner';
import type { StrategyRegistry } from '../../agent/strategies';
import type { PreparedRuntimeContext } from './runtimeContextBuilder';
import { RuntimeExecutionFactory } from './runtimeExecutionFactory';
import { RuntimeResultFinalizer } from './runtimeResultFinalizer';
import { RuntimeUpdateBridge } from './runtimeUpdateBridge';
import type { RuntimeModeHandler } from './runtimeModeContracts';
import { InitialModeHandler } from './modeHandlers/initialModeHandler';
import { FollowUpModeHandler } from './modeHandlers/followUpModeHandler';
import { ClarifyModeHandler } from './modeHandlers/clarifyModeHandler';

interface RuntimeModeExecutorInput {
  runtimeConfig?: AgentRuntimeConfig;
  modelRouter?: ModelRouter;
  executionFactory?: RuntimeExecutionFactory;
  resultFinalizer?: RuntimeResultFinalizer;
  incrementalAnalyzer?: IncrementalAnalyzer;
  focusStore?: FocusStore;
  agentRegistry?: DomainAgentRegistry;
  strategyPlanner?: IterationStrategyPlanner;
  strategyRegistry?: StrategyRegistry;
  updateBridge?: RuntimeUpdateBridge;
  handlers?: RuntimeModeHandler[];
}

interface RuntimeModeDefaultDeps {
  runtimeConfig: AgentRuntimeConfig;
  modelRouter: ModelRouter;
  executionFactory: RuntimeExecutionFactory;
  resultFinalizer: RuntimeResultFinalizer;
  incrementalAnalyzer: IncrementalAnalyzer;
  focusStore: FocusStore;
  agentRegistry: DomainAgentRegistry;
  strategyPlanner: IterationStrategyPlanner;
  strategyRegistry: StrategyRegistry;
  updateBridge: RuntimeUpdateBridge;
}

export class RuntimeModeExecutor {
  private readonly handlers: RuntimeModeHandler[];

  constructor(input: RuntimeModeExecutorInput) {
    if (Array.isArray(input.handlers) && input.handlers.length > 0) {
      this.handlers = input.handlers;
      return;
    }

    this.handlers = this.createDefaultHandlers(input);
  }

  async execute(
    runtimeContext: PreparedRuntimeContext,
    query: string,
    sessionId: string,
    traceId: string
  ): Promise<AnalysisResult> {
    const mode = runtimeContext.decisionContext.mode;
    const handler = this.handlers.find(candidate => candidate.supports(mode))
      || this.handlers.find(candidate => candidate.supports('initial'));

    if (!handler) {
      throw new Error(`No runtime mode handler registered for mode: ${mode}`);
    }

    return handler.execute({
      runtimeContext,
      query,
      sessionId,
      traceId,
    });
  }

  private createDefaultHandlers(input: RuntimeModeExecutorInput): RuntimeModeHandler[] {
    const required = this.resolveRequiredDeps(input);

    return [
      new ClarifyModeHandler({
        modelRouter: required.modelRouter,
      }),
      new FollowUpModeHandler({
        runtimeConfig: required.runtimeConfig,
        executionFactory: required.executionFactory,
        resultFinalizer: required.resultFinalizer,
        incrementalAnalyzer: required.incrementalAnalyzer,
        updateBridge: required.updateBridge,
      }),
      new InitialModeHandler({
        runtimeConfig: required.runtimeConfig,
        modelRouter: required.modelRouter,
        executionFactory: required.executionFactory,
        resultFinalizer: required.resultFinalizer,
        incrementalAnalyzer: required.incrementalAnalyzer,
        focusStore: required.focusStore,
        agentRegistry: required.agentRegistry,
        strategyPlanner: required.strategyPlanner,
        strategyRegistry: required.strategyRegistry,
        updateBridge: required.updateBridge,
      }),
    ];
  }

  private resolveRequiredDeps(input: RuntimeModeExecutorInput): RuntimeModeDefaultDeps {
    const {
      runtimeConfig,
      modelRouter,
      executionFactory,
      resultFinalizer,
      incrementalAnalyzer,
      focusStore,
      agentRegistry,
      strategyPlanner,
      strategyRegistry,
      updateBridge,
    } = input;

    const missing: string[] = [];

    if (!runtimeConfig) missing.push('runtimeConfig');
    if (!modelRouter) missing.push('modelRouter');
    if (!executionFactory) missing.push('executionFactory');
    if (!resultFinalizer) missing.push('resultFinalizer');
    if (!incrementalAnalyzer) missing.push('incrementalAnalyzer');
    if (!focusStore) missing.push('focusStore');
    if (!agentRegistry) missing.push('agentRegistry');
    if (!strategyPlanner) missing.push('strategyPlanner');
    if (!strategyRegistry) missing.push('strategyRegistry');
    if (!updateBridge) missing.push('updateBridge');

    if (missing.length > 0) {
      throw new Error(`RuntimeModeExecutor missing required dependencies: ${missing.join(', ')}`);
    }

    return {
      runtimeConfig: runtimeConfig as AgentRuntimeConfig,
      modelRouter: modelRouter as ModelRouter,
      executionFactory: executionFactory as RuntimeExecutionFactory,
      resultFinalizer: resultFinalizer as RuntimeResultFinalizer,
      incrementalAnalyzer: incrementalAnalyzer as IncrementalAnalyzer,
      focusStore: focusStore as FocusStore,
      agentRegistry: agentRegistry as DomainAgentRegistry,
      strategyPlanner: strategyPlanner as IterationStrategyPlanner,
      strategyRegistry: strategyRegistry as StrategyRegistry,
      updateBridge: updateBridge as RuntimeUpdateBridge,
    };
  }
}
