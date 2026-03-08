import type { SceneType } from './sceneClassifier';
import { getRegisteredScenes } from './strategyLoader';

export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

export interface ClaudeAgentConfig {
  model: string;
  maxTurns: number;
  maxBudgetUsd?: number;
  cwd: string;
  effort: EffortLevel;
  /** Enable sub-agent delegation (frame-expert, system-expert, startup-expert). Default: false */
  enableSubAgents: boolean;
  /** Enable conclusion verification (heuristic + LLM). Default: false */
  enableVerification: boolean;
  /** Per sub-agent timeout in ms. Sub-agents exceeding this are stopped via stopTask(). Default: 120000 (2min) */
  subAgentTimeoutMs: number;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
// Scrolling pipeline needs: 1 time-range query + 1 scrolling_analysis + 5 jank_frame_detail + conclusion = ~8-10 turns
const DEFAULT_MAX_TURNS = 15;
const DEFAULT_EFFORT: EffortLevel = 'high';

export function loadClaudeConfig(overrides?: Partial<ClaudeAgentConfig>): ClaudeAgentConfig {
  return {
    model: overrides?.model ?? process.env.CLAUDE_MODEL ?? DEFAULT_MODEL,
    maxTurns: overrides?.maxTurns
      ?? (process.env.CLAUDE_MAX_TURNS ? parseInt(process.env.CLAUDE_MAX_TURNS, 10) : DEFAULT_MAX_TURNS),
    maxBudgetUsd: overrides?.maxBudgetUsd
      ?? (process.env.CLAUDE_MAX_BUDGET_USD ? parseFloat(process.env.CLAUDE_MAX_BUDGET_USD) : undefined),
    cwd: overrides?.cwd ?? process.env.CLAUDE_CWD ?? process.cwd(),
    effort: (overrides?.effort ?? process.env.CLAUDE_EFFORT ?? DEFAULT_EFFORT) as EffortLevel,
    enableSubAgents: overrides?.enableSubAgents ?? process.env.CLAUDE_ENABLE_SUB_AGENTS === 'true',
    enableVerification: overrides?.enableVerification ?? (process.env.CLAUDE_ENABLE_VERIFICATION !== 'false'),
    subAgentTimeoutMs: overrides?.subAgentTimeoutMs
      ?? (process.env.CLAUDE_SUB_AGENT_TIMEOUT_MS ? parseInt(process.env.CLAUDE_SUB_AGENT_TIMEOUT_MS, 10) : 120_000),
  };
}

/**
 * Resolve effort level by scene type.
 * Deterministic pipelines (scrolling/startup/anr) use 'medium' since the workflow is prescriptive.
 * Open-ended queries ('general') use the configured default (typically 'high').
 */
export function resolveEffort(config: ClaudeAgentConfig, sceneType?: SceneType): EffortLevel {
  // Env override always wins (read directly, not via config which may have overrides)
  if (process.env.CLAUDE_EFFORT) return process.env.CLAUDE_EFFORT as EffortLevel;
  if (!sceneType) return config.effort;

  const scenes = getRegisteredScenes();
  const scene = scenes.find(s => s.scene === sceneType);
  if (scene?.effort) return scene.effort as EffortLevel;
  return config.effort;
}

/**
 * Check if ClaudeRuntime (agentv3) is the active orchestrator.
 * Defaults to true — agentv2 is deprecated. Set AI_SERVICE=deepseek to use legacy path.
 */
export function isClaudeCodeEnabled(): boolean {
  const service = process.env.AI_SERVICE;
  // Default to claude-code when AI_SERVICE is not set
  if (!service) return true;
  if (service === 'claude-code') return true;
  // Legacy path — log deprecation warning once
  if (!isClaudeCodeEnabled._warned) {
    isClaudeCodeEnabled._warned = true;
    console.warn(`[ClaudeConfig] AI_SERVICE="${service}" uses deprecated agentv2 runtime. Migrate to AI_SERVICE=claude-code.`);
  }
  return false;
}
isClaudeCodeEnabled._warned = false;
