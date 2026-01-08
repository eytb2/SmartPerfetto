/**
 * SmartPerfetto Agent Module
 *
 * 导出所有 Agent 组件
 */

// 旧架构 - 保持兼容
export { BaseExpertAgent, LLMClient } from './baseExpertAgent';
export { ScrollingExpertAgent, createScrollingExpertAgent } from './scrollingExpertAgent';
export {
  SceneReconstructionExpertAgent,
  createSceneReconstructionAgent,
  DetectedScene,
  TrackEvent,
  SceneReconstructionResult,
  SceneCategory,
} from './sceneReconstructionAgent';

// 新架构 - SubAgent 基类和专家
export { BaseSubAgent } from './base/baseSubAgent';
export type { AgentTool, ThinkResult } from './base/baseSubAgent';

export { PlannerAgent } from './plannerAgent';
export { EvaluatorAgent } from './evaluatorAgent';

// 重新导出类型
export type {
  SubAgentConfig,
  SubAgentContext,
  SubAgentResult,
  Evaluation,
  EvaluationFeedback,
  EvaluationCriteria,
} from '../types';
