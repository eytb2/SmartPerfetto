import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { TraceProcessorService } from '../services/traceProcessorService';
import { createSkillExecutor } from '../services/skillEngine/skillExecutor';
import { getSkillAnalysisAdapter } from '../services/skillEngine/skillAnalysisAdapter';
import { ensureSkillRegistryInitialized, skillRegistry } from '../services/skillEngine/skillLoader';
import { createArchitectureDetector } from '../agent/detectors/architectureDetector';
import { sessionContextManager } from '../agent/context/enhancedSessionContext';
import type { StreamingUpdate, Finding } from '../agent/types';
// StreamingUpdate is used both in the class and in the module-level sdkQueryWithRetry function
import type { AnalysisResult, AnalysisOptions, IOrchestrator } from '../agent/core/orchestratorTypes';
import type { ArchitectureInfo } from '../agent/detectors/types';

import { createClaudeMcpServer, loadLearnedSqlFixPairs } from './claudeMcpServer';
import { buildSystemPrompt } from './claudeSystemPrompt';
import { createSseBridge } from './claudeSseBridge';
import { extractFindingsFromText, extractFindingsFromSkillResult, mergeFindings } from './claudeFindingExtractor';
import { loadClaudeConfig, resolveEffort, type ClaudeAgentConfig } from './claudeConfig';
import { detectFocusApps } from './focusAppDetector';
import { classifyScene } from './sceneClassifier';
import { buildAgentDefinitions } from './claudeAgentDefinitions';
import { getExtendedKnowledgeBase } from '../services/sqlKnowledgeBase';
import type { ClaudeAnalysisContext, AnalysisNote, AnalysisPlanV3 } from './types';
import { ArtifactStore } from './artifactStore';
import {
  extractTraceFeatures,
  extractKeyInsights,
  saveAnalysisPattern,
  buildPatternContextSection,
} from './analysisPatternMemory';
import { verifyConclusion, generateCorrectionPrompt } from './claudeVerifier';
import {
  captureEntitiesFromResponses,
  applyCapturedEntities,
} from '../agent/core/entityCapture';

const SESSION_MAP_FILE = path.resolve(__dirname, '../../logs/claude_session_map.json');
/** Max age for session map entries before pruning (24 hours). */
const SESSION_MAP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface SessionMapEntry {
  sdkSessionId: string;
  updatedAt: number;
}

function loadPersistedSessionMap(): Map<string, SessionMapEntry> {
  try {
    if (fs.existsSync(SESSION_MAP_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_MAP_FILE, 'utf-8'));
      const map = new Map<string, SessionMapEntry>();
      for (const [key, value] of Object.entries(data)) {
        // Migration: old format stored plain string, new format stores {sdkSessionId, updatedAt}
        if (typeof value === 'string') {
          map.set(key, { sdkSessionId: value, updatedAt: Date.now() });
        } else if (value && typeof value === 'object') {
          map.set(key, value as SessionMapEntry);
        }
      }
      return map;
    }
  } catch {
    // Ignore — start with empty map
  }
  return new Map();
}

/** Debounce timer for session map persistence — avoids blocking event loop on every SDK message. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 2000;

function savePersistedSessionMap(map: Map<string, SessionMapEntry>): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    savePersistedSessionMapSync(map);
  }, SAVE_DEBOUNCE_MS);
}

/** Immediate save — used by debounce timer and for critical operations (session removal). */
function savePersistedSessionMapSync(map: Map<string, SessionMapEntry>): void {
  try {
    const dir = path.dirname(SESSION_MAP_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Prune stale entries before saving
    const now = Date.now();
    for (const [key, entry] of map) {
      if (now - entry.updatedAt > SESSION_MAP_MAX_AGE_MS) {
        map.delete(key);
      }
    }

    const tmpFile = SESSION_MAP_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(Object.fromEntries(map)));
    fs.renameSync(tmpFile, SESSION_MAP_FILE);
  } catch (err) {
    console.warn('[ClaudeRuntime] Failed to persist session map:', (err as Error).message);
  }
}

const ALLOWED_TOOLS = [
  'mcp__smartperfetto__execute_sql',
  'mcp__smartperfetto__invoke_skill',
  'mcp__smartperfetto__list_skills',
  'mcp__smartperfetto__detect_architecture',
  'mcp__smartperfetto__lookup_sql_schema',
  'mcp__smartperfetto__write_analysis_note',
  'mcp__smartperfetto__fetch_artifact',
  'mcp__smartperfetto__query_perfetto_source',
  'mcp__smartperfetto__submit_plan',
  'mcp__smartperfetto__update_plan_phase',
];

/** Check if an error is retryable (API overload/server errors). */
function isRetryableError(err: Error): boolean {
  const msg = err.message || '';
  // Anthropic API errors: 529 (overload), 500 (server), 503 (service unavailable)
  return /529|overload|500|server error|503|service unavailable|ECONNRESET|ETIMEDOUT/i.test(msg);
}

/** Sleep for the given milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrap sdkQuery with exponential backoff retry for transient API errors.
 * Only retries the initial call — mid-stream errors are handled by existing try/catch.
 */
function sdkQueryWithRetry(
  params: Parameters<typeof sdkQuery>[0],
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    emitUpdate?: (update: StreamingUpdate) => void;
  } = {},
): ReturnType<typeof sdkQuery> {
  const { maxRetries = 2, baseDelayMs = 2000, emitUpdate } = options;

  // We can't directly retry an async iterable, so we use a generator wrapper.
  // On the first call to next(), we attempt sdkQuery. If it throws, we retry.
  async function* retryableStream() {
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const stream = sdkQuery(params);
        // Yield all messages from the stream
        for await (const msg of stream) {
          yield msg;
        }
        return; // Success — exit generator
      } catch (err) {
        lastErr = err as Error;
        if (isRetryableError(lastErr) && attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          console.warn(`[ClaudeRuntime] API error (attempt ${attempt + 1}/${maxRetries + 1}): ${lastErr.message}. Retrying in ${delay}ms...`);
          emitUpdate?.({
            type: 'progress',
            content: { phase: 'starting', message: `API 暂时不可用，${Math.round(delay / 1000)}s 后重试 (${attempt + 1}/${maxRetries})...` },
            timestamp: Date.now(),
          });
          await sleep(delay);
          continue;
        }
        throw lastErr; // Non-retryable or max retries exceeded
      }
    }
    if (lastErr) throw lastErr;
  }

  return retryableStream() as ReturnType<typeof sdkQuery>;
}

/**
 * Claude Agent SDK runtime for SmartPerfetto.
 * Replaces the agentv2 governance pipeline with Claude-as-orchestrator.
 * Implements the same EventEmitter + analyze() interface as AgentRuntime.
 */
export class ClaudeRuntime extends EventEmitter implements IOrchestrator {
  private traceProcessorService: TraceProcessorService;
  private config: ClaudeAgentConfig;
  private sessionMap: Map<string, SessionMapEntry>;
  /** Cache architecture detection results per traceId (deterministic per trace). */
  private architectureCache: Map<string, ArchitectureInfo> = new Map();
  /** Per-session artifact stores — persist across turns within a session. */
  private artifactStores: Map<string, ArtifactStore> = new Map();
  /** Per-session analysis notes — persist across turns within a session. */
  private sessionNotes: Map<string, AnalysisNote[]> = new Map();
  /** Per-session SQL error tracking for error-fix pair learning. */
  private sessionSqlErrors: Map<string, Array<{ errorSql: string; errorMessage: string; timestamp: number }>> = new Map();
  /** Per-session analysis plans for plan adherence tracking. */
  private sessionPlans: Map<string, { current: AnalysisPlanV3 | null }> = new Map();
  /** Guard against concurrent analyze() calls for the same session. */
  private activeAnalyses: Set<string> = new Set();

  constructor(traceProcessorService: TraceProcessorService, config?: Partial<ClaudeAgentConfig>) {
    super();
    this.traceProcessorService = traceProcessorService;
    this.config = loadClaudeConfig(config);
    this.sessionMap = loadPersistedSessionMap();
  }

  /** Restore a previously persisted SDK session mapping (e.g., after server restart). */
  restoreSessionMapping(smartPerfettoSessionId: string, sdkSessionId: string): void {
    this.sessionMap.set(smartPerfettoSessionId, { sdkSessionId, updatedAt: Date.now() });
  }

  /** Get SDK session ID for persistence. */
  getSdkSessionId(smartPerfettoSessionId: string): string | undefined {
    return this.sessionMap.get(smartPerfettoSessionId)?.sdkSessionId;
  }

  async analyze(
    query: string,
    sessionId: string,
    traceId: string,
    options: AnalysisOptions = {},
  ): Promise<AnalysisResult> {
    // Prevent concurrent analyze() calls for the same session
    if (this.activeAnalyses.has(sessionId)) {
      throw new Error(`Analysis already in progress for session ${sessionId}`);
    }
    this.activeAnalyses.add(sessionId);

    const startTime = Date.now();
    const allFindings: Finding[][] = [];
    let conclusionText = '';
    let sdkSessionId: string | undefined;
    let rounds = 0;

    try {
      const ctx = await this.prepareAnalysisContext(query, sessionId, traceId, options, allFindings);

      const bridge = createSseBridge((update: StreamingUpdate) => {
        this.emitUpdate(update);
        if (update.type === 'agent_response' && update.content?.result) {
          try {
            const parsed = typeof update.content.result === 'string'
              ? JSON.parse(update.content.result)
              : update.content.result;
            if (parsed?.success && parsed?.skillId) {
              allFindings.push(extractFindingsFromSkillResult(parsed));
            }
            if (parsed?.success && parsed?.displayResults) {
              this.captureEntitiesFromSkillDisplayResults(parsed.displayResults, ctx.entityStore);
            }
          } catch {
            // Not a skill result — ignore
          }
        }
      });

      this.emitUpdate({
        type: 'progress',
        content: { phase: 'starting', message: `使用 ${this.config.model} 开始分析 (effort: ${ctx.effectiveEffort})...` },
        timestamp: Date.now(),
      });

      const existingSdkSessionId = this.sessionMap.get(sessionId)?.sdkSessionId;
      const stream = sdkQueryWithRetry({
        prompt: query,
        options: {
          model: this.config.model,
          maxTurns: this.config.maxTurns,
          systemPrompt: ctx.systemPrompt,
          mcpServers: { smartperfetto: ctx.mcpServer },
          includePartialMessages: true,
          permissionMode: 'bypassPermissions' as const,
          allowDangerouslySkipPermissions: true,
          cwd: this.config.cwd,
          effort: ctx.effectiveEffort,
          allowedTools: ALLOWED_TOOLS,
          ...(this.config.maxBudgetUsd ? { maxBudgetUsd: this.config.maxBudgetUsd } : {}),
          ...(existingSdkSessionId ? { resume: existingSdkSessionId } : {}),
          ...(ctx.agents ? { agents: ctx.agents } : {}),
        },
      }, { emitUpdate: (update) => this.emitUpdate(update) });

      let finalResult: string | undefined;

      // Safety timeout with stream cancellation via Promise.race
      const timeoutMs = (this.config.maxTurns || 15) * 20_000; // 20s per turn, not 60s
      let timedOut = false;

      // Sub-agent timeout tracking — stop tasks that exceed subAgentTimeoutMs
      const activeSubAgentTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
      const subAgentTimeoutMs = this.config.subAgentTimeoutMs;

      // P2-1: Turn-level autonomy watchdog — detect repetitive tool failures
      const toolCallHistory: Array<{ name: string; success: boolean }> = [];
      const WATCHDOG_WINDOW = 3; // consecutive same-tool failures to trigger warning
      let watchdogWarningEmitted = false;

      const processStream = async () => {
        for await (const msg of stream) {
          if (timedOut) break; // P0-1: Actually cancel stream on timeout
          if (msg.session_id && !sdkSessionId) {
            sdkSessionId = msg.session_id;
            this.sessionMap.set(sessionId, { sdkSessionId, updatedAt: Date.now() });
            savePersistedSessionMap(this.sessionMap);
          }

          // Track sub-agent lifecycle for per-agent timeouts
          if ((msg as any).type === 'system' && (msg as any).subtype === 'task_started') {
            const taskId = (msg as any).task_id;
            if (taskId && subAgentTimeoutMs > 0) {
              const timer = setTimeout(() => {
                console.warn(`[ClaudeRuntime] Sub-agent timeout: stopping task ${taskId} after ${subAgentTimeoutMs / 1000}s`);
                activeSubAgentTimers.delete(taskId);
                if (typeof (stream as any).stopTask === 'function') {
                  (stream as any).stopTask(taskId).catch((err: Error) => {
                    console.warn(`[ClaudeRuntime] Failed to stop sub-agent task ${taskId}:`, err.message);
                  });
                }
                // P1-6: Record timeout as a finding so it's reflected in confidence
                allFindings.push([{
                  id: `sub-agent-timeout-${taskId}`,
                  title: `子代理超时`,
                  severity: 'medium' as const,
                  category: 'sub-agent',
                  description: `子代理 ${taskId} 超时 (${subAgentTimeoutMs / 1000}s)，分析可能不完整`,
                  confidence: 0.3,
                }]);
                this.emitUpdate({
                  type: 'progress',
                  content: { phase: 'analyzing', message: `子代理超时 (${subAgentTimeoutMs / 1000}s)，已停止` },
                  timestamp: Date.now(),
                });
              }, subAgentTimeoutMs);
              activeSubAgentTimers.set(taskId, timer);
            }
          }
          if ((msg as any).type === 'system' && (msg as any).subtype === 'task_notification') {
            const taskId = (msg as any).task_id;
            if (taskId) {
              const timer = activeSubAgentTimers.get(taskId);
              if (timer) {
                clearTimeout(timer);
                activeSubAgentTimers.delete(taskId);
              }
            }
            // P1-5: Extract findings from sub-agent completion summaries.
            // Without this, sub-agent evidence is only in the conclusion text
            // and not merged into allFindings for confidence estimation.
            const summary = (msg as any).summary || '';
            const status = (msg as any).status || 'completed';
            if (status === 'completed' && summary) {
              allFindings.push(extractFindingsFromText(summary));
            }
          }

          // Bridge SDK messages to SSE events
          try {
            bridge(msg);
          } catch (bridgeErr) {
            console.warn('[ClaudeRuntime] SSE bridge error (non-fatal):', (bridgeErr as Error).message);
          }

          // P2-1: Watchdog — track tool calls for repetitive failure detection
          if (msg.type === 'assistant' && Array.isArray((msg as any).message?.content)) {
            for (const block of (msg as any).message.content) {
              if (block.type === 'tool_use') {
                toolCallHistory.push({ name: block.name, success: true }); // assume success, update on result
              }
            }
          }
          if (msg.type === 'user' && (msg as any).tool_use_result !== undefined) {
            const result = (msg as any).tool_use_result;
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
            const isFailed = resultStr.includes('"success":false') || resultStr.includes('"isError":true');
            if (toolCallHistory.length > 0) {
              toolCallHistory[toolCallHistory.length - 1].success = !isFailed;
            }
            // Check for consecutive same-tool failures
            if (!watchdogWarningEmitted && toolCallHistory.length >= WATCHDOG_WINDOW) {
              const recent = toolCallHistory.slice(-WATCHDOG_WINDOW);
              const allSameTool = recent.every(t => t.name === recent[0].name);
              const allFailed = recent.every(t => !t.success);
              if (allSameTool && allFailed) {
                watchdogWarningEmitted = true;
                const toolName = recent[0].name.replace('mcp__smartperfetto__', '');
                console.warn(`[ClaudeRuntime] Watchdog: ${WATCHDOG_WINDOW} consecutive failures for ${toolName}`);
                this.emitUpdate({
                  type: 'progress',
                  content: {
                    phase: 'analyzing',
                    message: `⚠ 检测到 ${toolName} 连续 ${WATCHDOG_WINDOW} 次失败，建议切换分析策略`,
                  },
                  timestamp: Date.now(),
                });
              }
            }
            // Also track tool call for plan adherence (P0-1)
            if (ctx.analysisPlan.current && toolCallHistory.length > 0) {
              const lastTool = toolCallHistory[toolCallHistory.length - 1];
              ctx.analysisPlan.current.toolCallLog.push({
                toolName: lastTool.name,
                timestamp: Date.now(),
              });
            }
          }

          if (msg.type === 'result') {
            rounds = (msg as any).num_turns || rounds;
            if ((msg as any).subtype === 'success') {
              finalResult = (msg as any).result;
            }
          }
        }
        // Clean up any remaining sub-agent timers
        for (const timer of activeSubAgentTimers.values()) clearTimeout(timer);
        activeSubAgentTimers.clear();
      };

      let safetyTimer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<void>((_, reject) => {
        safetyTimer = setTimeout(() => {
          timedOut = true;
          // Cancel the SDK stream to stop consuming API credits.
          // Try async generator .return() first, then .abort() if available.
          // Use .then/.catch instead of await (setTimeout callback is not async).
          const cancelStream = () => {
            try {
              if (typeof (stream as any).return === 'function') {
                const ret = (stream as any).return();
                if (ret && typeof ret.catch === 'function') ret.catch(() => {});
              }
              if (typeof (stream as any).abort === 'function') {
                (stream as any).abort();
              }
            } catch (cancelErr) {
              console.warn('[ClaudeRuntime] Stream cancellation error (non-fatal):', (cancelErr as Error).message);
            }
          };
          cancelStream();
          reject(new Error(`Analysis safety timeout after ${timeoutMs / 1000}s`));
        }, timeoutMs);
      });

      try {
        await Promise.race([processStream(), timeoutPromise]);
      } catch (err) {
        if (timedOut) {
          console.error('[ClaudeRuntime] Analysis safety timeout reached — stream may still be active');
          this.emitUpdate({
            type: 'progress',
            content: { phase: 'concluding', message: '分析超时，正在生成已有结果的结论...' },
            timestamp: Date.now(),
          });
        } else {
          throw err;
        }
      } finally {
        // Clear the safety timer to prevent memory leak on normal completion
        if (safetyTimer) clearTimeout(safetyTimer);
      }

      conclusionText = finalResult || '';
      allFindings.push(extractFindingsFromText(conclusionText));
      let mergedFindings = mergeFindings(allFindings);

      // Verification + reflection-driven retry (P0-2)
      // Default ON. When verification finds ERROR-level issues, do one correction retry.
      if (this.config.enableVerification && mergedFindings.length > 0) {
        try {
          const verification = await verifyConclusion(mergedFindings, conclusionText, {
            emitUpdate: (update) => this.emitUpdate(update),
            enableLLM: true,
            plan: ctx.analysisPlan.current,
          });
          console.log(`[ClaudeRuntime] Verification: ${verification.passed ? 'PASSED' : 'ISSUES FOUND'} (${verification.durationMs}ms, ${verification.heuristicIssues.length} heuristic + ${verification.llmIssues?.length || 0} LLM issues)`);

          // Reflection-driven retry: if ERROR-level issues found, generate correction prompt and retry once
          if (!verification.passed && sdkSessionId) {
            const allIssues = [...verification.heuristicIssues, ...(verification.llmIssues || [])];
            const errorCount = allIssues.filter(i => i.severity === 'error').length;
            if (errorCount > 0) {
              this.emitUpdate({
                type: 'progress',
                content: { phase: 'concluding', message: `发现 ${errorCount} 个 ERROR 级问题，启动修正重试...` },
                timestamp: Date.now(),
              });

              try {
                const correctionPrompt = generateCorrectionPrompt(allIssues, conclusionText);
                const correctionStream = sdkQuery({
                  prompt: correctionPrompt,
                  options: {
                    model: this.config.model,
                    maxTurns: 5,
                    systemPrompt: ctx.systemPrompt,
                    mcpServers: { smartperfetto: ctx.mcpServer },
                    includePartialMessages: true,
                    permissionMode: 'bypassPermissions' as const,
                    allowDangerouslySkipPermissions: true,
                    cwd: this.config.cwd,
                    effort: ctx.effectiveEffort,
                    allowedTools: ALLOWED_TOOLS,
                    resume: sdkSessionId,
                  },
                });

                let correctedResult = '';
                for await (const msg of correctionStream) {
                  if (msg.type === 'result' && (msg as any).subtype === 'success') {
                    correctedResult = (msg as any).result || '';
                    rounds += (msg as any).num_turns || 0;
                  }
                  // Bridge correction stream events to SSE
                  try { bridge(msg); } catch { /* non-fatal */ }
                }

                if (correctedResult && correctedResult.length > conclusionText.length * 0.5) {
                  conclusionText = correctedResult;
                  // Re-extract findings from corrected conclusion and re-merge
                  allFindings.push(extractFindingsFromText(correctedResult));
                  mergedFindings = mergeFindings(allFindings);
                  console.log('[ClaudeRuntime] Reflection retry: conclusion corrected successfully');
                } else {
                  console.log('[ClaudeRuntime] Reflection retry: correction too short or empty, keeping original');
                }
              } catch (correctionErr) {
                console.warn('[ClaudeRuntime] Reflection retry failed (non-blocking):', (correctionErr as Error).message);
              }
            }
          }
        } catch (err) {
          console.warn('[ClaudeRuntime] Verification failed (non-blocking):', (err as Error).message);
        }
      }

      const turnConfidence = this.estimateConfidence(mergedFindings);

      ctx.sessionContext.addTurn(
        query,
        {
          primaryGoal: query,
          aspects: [],
          expectedOutputType: 'diagnosis',
          complexity: 'complex',
          followUpType: ctx.previousTurns.length > 0 ? 'extend' : 'initial',
        },
        {
          agentId: 'claude-agent',
          success: true,
          findings: mergedFindings,
          confidence: turnConfidence,
          message: conclusionText,
        },
        mergedFindings,
      );

      ctx.sessionContext.updateWorkingMemoryFromConclusion({
        turnIndex: ctx.previousTurns.length,
        query,
        conclusion: conclusionText,
        confidence: turnConfidence,
      });

      // P2-2: Save analysis pattern to long-term memory (fire-and-forget)
      if (mergedFindings.length > 0 && turnConfidence > 0.3) {
        const sceneType = classifyScene(query);
        const fullFeatures = extractTraceFeatures({
          architectureType: ctx.analysisPlan?.current ? undefined : undefined, // architecture from context
          sceneType,
          packageName: options.packageName,
          findingTitles: mergedFindings.map(f => f.title),
          findingCategories: mergedFindings.map(f => f.category).filter(Boolean) as string[],
        });
        const insights = extractKeyInsights(mergedFindings, conclusionText);
        saveAnalysisPattern(fullFeatures, insights, sceneType, undefined, turnConfidence)
          .catch(err => console.warn('[ClaudeRuntime] Pattern save failed:', (err as Error).message));
      }

      return {
        sessionId,
        success: true,
        findings: mergedFindings,
        hypotheses: [],
        conclusion: conclusionText,
        confidence: turnConfidence,
        rounds,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errMsg = (error as Error).message || 'Unknown error';
      console.error('[ClaudeRuntime] Analysis failed:', errMsg);
      this.emitUpdate({ type: 'error', content: { message: `分析失败: ${errMsg}` }, timestamp: Date.now() });

      return {
        sessionId,
        success: false,
        findings: mergeFindings(allFindings),
        hypotheses: [],
        conclusion: `分析过程中出错: ${errMsg}`,
        confidence: 0,
        rounds,
        totalDurationMs: Date.now() - startTime,
      };
    } finally {
      this.activeAnalyses.delete(sessionId);
    }
  }

  removeSession(sessionId: string): void {
    // Cancel any pending debounced save to prevent stale write after sync save
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    this.sessionMap.delete(sessionId);
    this.artifactStores.delete(sessionId);
    this.sessionNotes.delete(sessionId);
    this.sessionSqlErrors.delete(sessionId);
    this.sessionPlans.delete(sessionId);
    this.activeAnalyses.delete(sessionId);
    // Use immediate save — session is being removed, must persist before cleanup completes
    savePersistedSessionMapSync(this.sessionMap);
  }

  /** Clean up all session-scoped state for a given session. */
  cleanupSession(sessionId: string): void {
    this.removeSession(sessionId);
  }

  reset(): void {
    this.architectureCache.clear();
    // Also clear all session-scoped stores to prevent unbounded growth
    this.artifactStores.clear();
    this.sessionNotes.clear();
    this.sessionSqlErrors.clear();
    this.sessionPlans.clear();
    this.activeAnalyses.clear();
  }

  private emitUpdate(update: StreamingUpdate): void {
    this.emit('update', update);
  }

  /**
   * Collect the most recent findings from previous turns for system prompt injection.
   * Caps at 5 findings to prevent unbounded prompt growth.
   */
  private collectPreviousFindings(sessionContext: any, maxTurns?: number): Finding[] {
    try {
      let turns = sessionContext.getAllTurns?.() || [];
      if (maxTurns && maxTurns > 0) {
        turns = turns.slice(-maxTurns);
      }
      return turns.flatMap((turn: any) => turn.findings || []).slice(-5);
    } catch {
      return [];
    }
  }

  /**
   * Build a compact entity context string for the system prompt.
   * Gives Claude awareness of known frames/sessions for drill-down resolution.
   */
  private buildEntityContext(entityStore: any): string | undefined {
    try {
      const stats = entityStore.getStats();
      if (stats.totalEntityCount === 0) return undefined;

      const lines: string[] = [];

      const frames = entityStore.getAllFrames?.() || [];
      if (frames.length > 0) {
        lines.push(`**帧 (${frames.length})**:`);
        for (const f of frames.slice(0, 15)) {
          const parts = [`frame_id=${f.frame_id}`];
          if (f.start_ts) parts.push(`ts=${f.start_ts}`);
          if (f.jank_type) parts.push(`jank=${f.jank_type}`);
          if (f.dur_ms) parts.push(`dur=${f.dur_ms}ms`);
          if (f.process_name) parts.push(`proc=${f.process_name}`);
          lines.push(`- ${parts.join(', ')}`);
        }
        if (frames.length > 15) lines.push(`- ...及其他 ${frames.length - 15} 帧`);
      }

      const sessions = entityStore.getAllSessions?.() || [];
      if (sessions.length > 0) {
        lines.push(`**滑动会话 (${sessions.length})**:`);
        for (const s of sessions.slice(0, 8)) {
          const parts = [`session_id=${s.session_id}`];
          if (s.start_ts) parts.push(`ts=${s.start_ts}`);
          if (s.jank_count) parts.push(`janks=${s.jank_count}`);
          if (s.process_name) parts.push(`proc=${s.process_name}`);
          lines.push(`- ${parts.join(', ')}`);
        }
      }

      return lines.length > 0 ? lines.join('\n') : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Prepare all context needed for a Claude analysis run.
   * Extracts focus app detection, architecture detection, session context,
   * scene classification, MCP server creation, and system prompt building
   * into a single cohesive preparation phase.
   */
  private async prepareAnalysisContext(
    query: string,
    sessionId: string,
    traceId: string,
    options: AnalysisOptions,
    allFindings: Finding[][],
  ) {
    // Phase 0: Detect focus apps from trace data
    let effectivePackageName = options.packageName;
    const focusResult = await detectFocusApps(this.traceProcessorService, traceId);

    if (focusResult.primaryApp) {
      if (!effectivePackageName) {
        effectivePackageName = focusResult.primaryApp;
        console.log(`[ClaudeRuntime] Auto-detected focus app: ${effectivePackageName} (via ${focusResult.method})`);
      } else {
        console.log(`[ClaudeRuntime] User-provided packageName: ${effectivePackageName}, also detected: ${focusResult.apps.map(a => a.packageName).join(', ')}`);
      }
      this.emitUpdate({
        type: 'progress',
        content: { phase: 'starting', message: `检测到焦点应用: ${focusResult.primaryApp} (${focusResult.method})` },
        timestamp: Date.now(),
      });
    }

    // Phase 1: Skill executor setup
    const skillExecutor = createSkillExecutor(this.traceProcessorService);
    await ensureSkillRegistryInitialized();
    skillExecutor.registerSkills(skillRegistry.getAllSkills());
    skillExecutor.setFragmentRegistry(skillRegistry.getFragmentCache());

    // Phase 2: Architecture detection (LRU cached per traceId)
    let architecture = this.architectureCache.get(traceId);
    if (architecture) {
      // LRU touch: delete and re-insert to move to end of Map iteration order
      this.architectureCache.delete(traceId);
      this.architectureCache.set(traceId, architecture);
    } else {
      try {
        const detector = createArchitectureDetector();
        architecture = await detector.detect({
          traceId,
          traceProcessorService: this.traceProcessorService,
          packageName: effectivePackageName,
        });
        if (architecture) {
          this.architectureCache.set(traceId, architecture);
          // LRU eviction: remove oldest entry (first key in Map)
          if (this.architectureCache.size > 50) {
            const firstKey = this.architectureCache.keys().next().value;
            if (firstKey) this.architectureCache.delete(firstKey);
          }
        }
        this.emitUpdate({ type: 'architecture_detected', content: { architecture }, timestamp: Date.now() });
      } catch (err) {
        console.warn('[ClaudeRuntime] Architecture detection failed:', (err as Error).message);
      }
    }

    // Phase 3: Session context + conversation history
    const sessionContext = sessionContextManager.getOrCreate(sessionId, traceId);
    const previousTurns = sessionContext.getAllTurns?.() || [];
    // Always include previous context regardless of SDK resume status.
    // When SDK resume succeeds, these add ~200-500 redundant tokens (harmless).
    // When SDK session has expired and resume fails silently, they prevent context loss.
    const previousFindings = this.collectPreviousFindings(sessionContext);
    const conversationSummary = previousTurns.length > 0
      ? sessionContext.generatePromptContext(2000)
      : undefined;

    // Phase 4: Entity store + entity context for drill-down
    const entityStore = sessionContext.getEntityStore();
    const entityContext = this.buildEntityContext(entityStore);

    // Phase 5: Scene classification + effort resolution
    const sceneType = classifyScene(query);
    const effectiveEffort = resolveEffort(this.config, sceneType);

    // Phase 5.5: Pattern memory — match similar historical traces (P2-2)
    const traceFeatures = extractTraceFeatures({
      architectureType: architecture?.type,
      sceneType,
      packageName: effectivePackageName,
    });
    const patternContext = buildPatternContextSection(traceFeatures);

    // Phase 6: Session-scoped artifact store + analysis notes
    if (!this.artifactStores.has(sessionId)) {
      this.artifactStores.set(sessionId, new ArtifactStore());
    }
    const artifactStore = this.artifactStores.get(sessionId)!;
    const notes = this.sessionNotes.get(sessionId) || [];
    if (!this.sessionNotes.has(sessionId)) {
      this.sessionNotes.set(sessionId, notes);
    }

    // Phase 6.5: Session-scoped analysis plan (P0-1: Planning capability)
    if (!this.sessionPlans.has(sessionId)) {
      this.sessionPlans.set(sessionId, { current: null });
    }
    const analysisPlan = this.sessionPlans.get(sessionId)!;
    // Reset plan for new analysis turn (plan is per-turn, not per-session)
    analysisPlan.current = null;

    // Phase 7: SQL error tracking for in-context learning
    // Seed new sessions with previously learned fix pairs from disk (cross-session learning)
    let sqlErrors = this.sessionSqlErrors.get(sessionId);
    if (!sqlErrors) {
      sqlErrors = loadLearnedSqlFixPairs(5);
      this.sessionSqlErrors.set(sessionId, sqlErrors);
    }

    // Phase 8: MCP server with all session-scoped state
    const mcpServer = createClaudeMcpServer({
      traceId,
      traceProcessorService: this.traceProcessorService,
      skillExecutor,
      packageName: effectivePackageName,
      emitUpdate: (update) => this.emitUpdate(update),
      onSkillResult: (result) => {
        if (result.displayResults) {
          this.captureEntitiesFromSkillDisplayResults(result.displayResults, entityStore);
        }
      },
      analysisNotes: notes,
      artifactStore,
      cachedArchitecture: architecture,
      recentSqlErrors: sqlErrors,
      analysisPlan: analysisPlan,
    });

    // Phase 9: Skill catalog (non-fatal — Claude can use list_skills tool as fallback)
    let skillCatalog: ClaudeAnalysisContext['skillCatalog'];
    try {
      const adapter = getSkillAnalysisAdapter(this.traceProcessorService);
      const skills = await adapter.listSkills();
      skillCatalog = skills.map(s => ({ id: s.id, displayName: s.displayName, description: s.description, type: s.type }));
    } catch {
      // Non-fatal
    }

    // Phase 10: Knowledge base context (non-fatal — Claude can use lookup_sql_schema tool)
    let knowledgeBaseContext: string | undefined;
    try {
      const kb = await getExtendedKnowledgeBase();
      knowledgeBaseContext = kb.getContextForAI(query, 8);
    } catch {
      // Non-fatal
    }

    // Phase 11: Sub-agent definitions (feature-gated)
    let agents: Record<string, any> | undefined;
    if (this.config.enableSubAgents && sceneType !== 'anr') {
      agents = buildAgentDefinitions(sceneType, {
        architecture,
        packageName: effectivePackageName,
      });
    }

    // Phase 12: SQL error-fix pairs for prompt injection
    const sqlErrorFixPairs = sqlErrors
      .filter((e: any) => e.fixedSql)
      .slice(-3)
      .map((e: any) => ({ errorSql: e.errorSql, errorMessage: e.errorMessage, fixedSql: e.fixedSql }));

    // Phase 13: System prompt assembly
    const systemPrompt = buildSystemPrompt({
      query,
      architecture,
      packageName: effectivePackageName,
      focusApps: focusResult.apps.length > 0 ? focusResult.apps : undefined,
      focusMethod: focusResult.method,
      previousFindings,
      conversationSummary,
      skillCatalog,
      knowledgeBaseContext,
      entityContext,
      sceneType,
      analysisNotes: notes.length > 0 ? notes : undefined,
      availableAgents: agents ? Object.keys(agents) : undefined,
      sqlErrorFixPairs: sqlErrorFixPairs.length > 0 ? sqlErrorFixPairs : undefined,
      patternContext,
    });

    return {
      mcpServer,
      systemPrompt,
      effectiveEffort,
      agents,
      sessionContext,
      previousTurns,
      entityStore,
      analysisPlan,
    };
  }

  private estimateConfidence(findings: Finding[]): number {
    if (findings.length === 0) return 0.3;
    const avg = findings.reduce((sum, f) => sum + (f.confidence ?? 0.5), 0) / findings.length;
    return Math.min(1, Math.max(0, avg));
  }

  /** Capture entities from skill displayResults into EntityStore for multi-turn drill-down. */
  private captureEntitiesFromSkillDisplayResults(
    displayResults: Array<{ stepId?: string; data?: any }>,
    entityStore: any,
  ): void {
    try {
      const data: Record<string, any> = {};
      for (const dr of displayResults) {
        if (dr.stepId && dr.data) {
          data[dr.stepId] = dr.data;
        }
      }
      const captured = captureEntitiesFromResponses([{
        agentId: 'claude-agent',
        success: true,
        toolResults: [{ toolName: 'invoke_skill', data }],
      } as any]);
      applyCapturedEntities(entityStore, captured);
    } catch (err) {
      console.warn('[ClaudeRuntime] Entity capture failed:', (err as Error).message);
    }
  }
}
