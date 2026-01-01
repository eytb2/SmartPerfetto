/**
 * Skill Engine
 *
 * A configurable skill system that allows performance experts to define
 * analysis workflows in YAML files without modifying code.
 *
 * Features:
 * - YAML-based skill definitions
 * - SOP documentation support (Markdown)
 * - Vendor-specific overrides (OPPO, vivo, Xiaomi, etc.)
 * - Automatic skill matching based on keywords and patterns
 * - Variable substitution in SQL queries
 * - Threshold-based evaluation and diagnostics
 */

export * from './types';
export * from './skillLoader';
export * from './skillExecutor';

// Re-export commonly used items
export {
  skillRegistry,
  initializeSkills,
  getSkillRegistry,
} from './skillLoader';

export {
  SkillExecutor,
  createSkillExecutor,
} from './skillExecutor';

export {
  SkillAnalysisAdapter,
  createSkillAnalysisAdapter,
  getSkillAnalysisAdapter,
} from './skillAnalysisAdapter';

// =============================================================================
// v2 Skill Engine Exports
// =============================================================================

// Note: types_v2 not re-exported to avoid naming conflicts with types.ts
// Import directly from './types_v2' if needed
export * from './skillLoaderV2';
export * from './skillExecutorV2';
export * from './skillAnalysisAdapterV2';

export {
  skillRegistryV2,
  ensureSkillRegistryV2Initialized,
  getSkillsDir,
} from './skillLoaderV2';

export {
  SkillExecutorV2,
  createSkillExecutorV2,
} from './skillExecutorV2';

export {
  SkillAnalysisAdapterV2,
  createSkillAnalysisAdapterV2,
  getSkillAnalysisAdapterV2,
} from './skillAnalysisAdapterV2';

// 智能摘要和回答生成器
export { smartSummaryGenerator, SmartSummaryGenerator } from './smartSummaryGenerator';
export { answerGenerator, AnswerGenerator } from './answerGenerator';

// 事件收集器
export {
  SkillEventCollector,
  createEventCollector,
  EventSummary,
  ProgressInfo,
} from './eventCollector';
