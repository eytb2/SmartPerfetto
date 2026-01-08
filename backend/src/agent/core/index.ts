/**
 * SmartPerfetto Agent Core Module
 *
 * 导出核心架构组件
 */

export { AgentStateMachine } from './stateMachine';
export { CircuitBreaker } from './circuitBreaker';
export { ModelRouter, AllModelsFailedError } from './modelRouter';
export { PipelineExecutor } from './pipelineExecutor';

// 重新导出类型
export type {
  // State Machine Types
  AgentPhase,
  StateEvent,
  Checkpoint,
  SerializedAgentState,
  StateMachineConfig,
  AgentStateMachineState,
  // Pipeline Types
  PipelineStage,
  StageResult,
  PipelineConfig,
  PipelineErrorDecision,
  PipelineResult,
  PipelineCallbacks,
  PipelineProgress,
  // Circuit Breaker Types
  CircuitState,
  CircuitBreakerConfig,
  CircuitDecision,
  CircuitDiagnostics,
  CircuitBreakerState,
  // Model Router Types
  ModelProvider,
  ModelStrength,
  TaskType,
  ModelProfile,
  ModelRouterConfig,
  ModelCallResult,
  EnsembleResult,
} from '../types';
