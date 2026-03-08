import type { ArchitectureInfo } from '../agent/detectors/types';
import type { Finding } from '../agent/types';
import type { DetectedFocusApp } from './focusAppDetector';
import type { SceneType } from './sceneClassifier';

export interface McpToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
}

export interface SqlQueryResult {
  columns: string[];
  rows: any[][];
  durationMs: number;
  error?: string;
}

export interface SqlSchemaEntry {
  id: string;
  name: string;
  category: string;
  type: 'function' | 'view' | 'table';
  description: string;
  /** Column definitions for tables/views (when available in the schema index) */
  columns?: Array<{ name: string; type?: string; description?: string }>;
  /** Parameter definitions for functions (when available in the schema index) */
  params?: Array<{ name: string; type?: string; description?: string }>;
}

export interface SqlSchemaIndex {
  version: string;
  generatedAt: string;
  templates: SqlSchemaEntry[];
}

/**
 * Maps a SmartPerfetto sessionId to Claude Agent SDK session state
 * for multi-turn conversation continuity via the V2 session API.
 */
export interface ClaudeSessionMapping {
  smartPerfettoSessionId: string;
  sdkSessionId?: string;
  traceId: string;
  architecture?: ArchitectureInfo;
  lastActivityAt: number;
}

/** Context assembled before calling Claude, injected into the system prompt. */
export interface ClaudeAnalysisContext {
  query: string;
  architecture?: ArchitectureInfo;
  packageName?: string;
  focusApps?: DetectedFocusApp[];
  /** Detection method used for focus apps — affects display labels */
  focusMethod?: 'battery_stats' | 'oom_adj' | 'frame_timeline' | 'none';
  previousFindings?: Finding[];
  conversationSummary?: string;
  skillCatalog?: Array<{ id: string; displayName: string; description: string; type: string }>;
  /** Perfetto SQL knowledge context matched to the user query (from ExtendedSqlKnowledgeBase) */
  knowledgeBaseContext?: string;
  /** Compact entity context from previous turns for drill-down / clarify resolution */
  entityContext?: string;
  /** Classified scene type for progressive prompt disclosure */
  sceneType?: SceneType;
  /** Structured analysis notes persisted by Claude via write_analysis_note tool */
  analysisNotes?: AnalysisNote[];
  /** Names of available sub-agents (when sub-agent mode is enabled) */
  availableAgents?: string[];
  /** Past SQL error-fix pairs for in-context learning */
  sqlErrorFixPairs?: Array<{ errorSql: string; errorMessage: string; fixedSql: string }>;
  /** Cross-session analysis pattern context (P2-2: Long-term memory) */
  patternContext?: string;
}

/** A structured note written by Claude during analysis for cross-turn persistence. */
export interface AnalysisNote {
  section: 'hypothesis' | 'finding' | 'observation' | 'next_step';
  content: string;
  priority: 'high' | 'medium' | 'low';
  timestamp: number;
}

// =============================================================================
// Planning Types (P0-1: Explicit planning capability)
// =============================================================================

/** A phase in Claude's analysis plan, submitted via submit_plan tool. */
export interface PlanPhase {
  id: string;
  name: string;
  goal: string;
  /** Expected tool names this phase will use (for adherence tracking) */
  expectedTools: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  completedAt?: number;
}

/** Structured analysis plan submitted by Claude before starting analysis. */
export interface AnalysisPlanV3 {
  phases: PlanPhase[];
  successCriteria: string;
  submittedAt: number;
  /** Tool calls matched to phases during execution */
  toolCallLog: ToolCallRecord[];
}

/** Record of a tool call for plan adherence tracking. */
export interface ToolCallRecord {
  toolName: string;
  timestamp: number;
  /** Phase ID this tool call was matched to (if any) */
  matchedPhaseId?: string;
}

// =============================================================================
// Analysis Pattern Memory Types (P2-2: Long-term memory)
// =============================================================================

/** A persistent analysis pattern learned from previous sessions. */
export interface AnalysisPatternEntry {
  id: string;
  /** Trace feature fingerprint for similarity matching */
  traceFeatures: string[];
  /** Scene type of the analysis */
  sceneType: string;
  /** Key insights discovered */
  keyInsights: string[];
  /** Architecture type */
  architectureType?: string;
  /** Confidence of the original analysis */
  confidence: number;
  /** Timestamp of creation */
  createdAt: number;
  /** Number of times this pattern was matched */
  matchCount: number;
}

/** Result of conclusion verification (heuristic + optional LLM). */
export interface VerificationResult {
  passed: boolean;
  heuristicIssues: VerificationIssue[];
  llmIssues?: VerificationIssue[];
  durationMs: number;
}

export interface VerificationIssue {
  type: 'missing_evidence' | 'too_many_criticals' | 'known_misdiagnosis' | 'severity_mismatch' | 'missing_check' | 'plan_deviation' | 'missing_reasoning';
  severity: 'warning' | 'error';
  message: string;
}
