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
import type { AnalysisResult, AnalysisOptions } from '../agent/core/orchestratorTypes';
import type { ArchitectureInfo } from '../agent/detectors/types';

import { createClaudeMcpServer } from './claudeMcpServer';
import { buildSystemPrompt } from './claudeSystemPrompt';
import { createSseBridge } from './claudeSseBridge';
import { extractFindingsFromText, extractFindingsFromSkillResult, mergeFindings } from './claudeFindingExtractor';
import { loadClaudeConfig, type ClaudeAgentConfig } from './claudeConfig';
import { detectFocusApps } from './focusAppDetector';
import { getExtendedKnowledgeBase } from '../services/sqlKnowledgeBase';
import type { ClaudeAnalysisContext } from './types';
import {
  captureEntitiesFromResponses,
  applyCapturedEntities,
} from '../agent/core/entityCapture';

const SESSION_MAP_FILE = path.resolve(__dirname, '../../logs/claude_session_map.json');

function loadPersistedSessionMap(): Map<string, string> {
  try {
    if (fs.existsSync(SESSION_MAP_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_MAP_FILE, 'utf-8'));
      return new Map(Object.entries(data));
    }
  } catch {
    // Ignore — start with empty map
  }
  return new Map();
}

function savePersistedSessionMap(map: Map<string, string>): void {
  try {
    const dir = path.dirname(SESSION_MAP_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_MAP_FILE, JSON.stringify(Object.fromEntries(map), null, 2));
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
];

/**
 * Claude Agent SDK runtime for SmartPerfetto.
 * Replaces the agentv2 governance pipeline with Claude-as-orchestrator.
 * Implements the same EventEmitter + analyze() interface as AgentRuntime.
 */
export class ClaudeRuntime extends EventEmitter {
  private traceProcessorService: TraceProcessorService;
  private config: ClaudeAgentConfig;
  private sessionMap: Map<string, string>;

  constructor(traceProcessorService: TraceProcessorService, config?: Partial<ClaudeAgentConfig>) {
    super();
    this.traceProcessorService = traceProcessorService;
    this.config = loadClaudeConfig(config);
    this.sessionMap = loadPersistedSessionMap();
  }

  /** Restore a previously persisted SDK session mapping (e.g., after server restart). */
  restoreSessionMapping(smartPerfettoSessionId: string, sdkSessionId: string): void {
    this.sessionMap.set(smartPerfettoSessionId, sdkSessionId);
  }

  /** Get SDK session ID for persistence. */
  getSdkSessionId(smartPerfettoSessionId: string): string | undefined {
    return this.sessionMap.get(smartPerfettoSessionId);
  }

  async analyze(
    query: string,
    sessionId: string,
    traceId: string,
    options: AnalysisOptions = {},
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const allFindings: Finding[][] = [];
    let conclusionText = '';
    let sdkSessionId: string | undefined;
    let rounds = 0;

    try {
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

      const skillExecutor = createSkillExecutor(this.traceProcessorService);
      // Load YAML skill definitions into the executor's registry.
      // Without this, all invoke_skill calls fail with "Skill not found".
      await ensureSkillRegistryInitialized();
      skillExecutor.registerSkills(skillRegistry.getAllSkills());
      skillExecutor.setFragmentRegistry(skillRegistry.getFragmentCache());

      const mcpServer = createClaudeMcpServer({
        traceId,
        traceProcessorService: this.traceProcessorService,
        skillExecutor,
        packageName: effectivePackageName,
        emitUpdate: (update) => this.emitUpdate(update),
      });

      let architecture: ArchitectureInfo | undefined;
      try {
        const detector = createArchitectureDetector();
        architecture = await detector.detect({
          traceId,
          traceProcessorService: this.traceProcessorService,
          packageName: effectivePackageName,
        });
        this.emitUpdate({ type: 'architecture_detected', content: { architecture }, timestamp: Date.now() });
      } catch (err) {
        console.warn('[ClaudeRuntime] Architecture detection failed:', (err as Error).message);
      }

      const sessionContext = sessionContextManager.getOrCreate(sessionId, traceId);
      const previousFindings = this.collectPreviousFindings(sessionContext);
      const conversationSummary = sessionContext.generatePromptContext(2000);

      let skillCatalog: ClaudeAnalysisContext['skillCatalog'];
      try {
        const adapter = getSkillAnalysisAdapter(this.traceProcessorService);
        const skills = await adapter.listSkills();
        skillCatalog = skills.map(s => ({ id: s.id, displayName: s.displayName, description: s.description, type: s.type }));
      } catch {
        // Non-fatal: Claude can still use the list_skills tool
      }

      let knowledgeBaseContext: string | undefined;
      try {
        const kb = await getExtendedKnowledgeBase();
        knowledgeBaseContext = kb.getContextForAI(query, 8);
      } catch {
        // Non-fatal: Claude can still use lookup_sql_schema tool
      }

      const systemPrompt = buildSystemPrompt({
        query,
        architecture,
        packageName: effectivePackageName,
        focusApps: focusResult.apps.length > 0 ? focusResult.apps : undefined,
        previousFindings,
        conversationSummary: previousFindings.length > 0 ? conversationSummary : undefined,
        skillCatalog,
        knowledgeBaseContext,
      });

      const entityStore = sessionContext.getEntityStore();

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
            // Capture entities from skill displayResults for multi-turn drill-down
            if (parsed?.success && parsed?.displayResults) {
              this.captureEntitiesFromSkillDisplayResults(parsed.displayResults, entityStore);
            }
          } catch {
            // Not a skill result — ignore
          }
        }
      });

      this.emitUpdate({
        type: 'progress',
        content: { phase: 'starting', message: `使用 ${this.config.model} 开始分析...` },
        timestamp: Date.now(),
      });

      const existingSdkSessionId = this.sessionMap.get(sessionId);
      const stream = sdkQuery({
        prompt: query,
        options: {
          model: this.config.model,
          maxTurns: this.config.maxTurns,
          systemPrompt,
          mcpServers: { smartperfetto: mcpServer },
          includePartialMessages: true,
          permissionMode: 'bypassPermissions' as const,
          allowDangerouslySkipPermissions: true,
          cwd: this.config.cwd,
          effort: this.config.effort,
          allowedTools: ALLOWED_TOOLS,
          ...(this.config.maxBudgetUsd ? { maxBudgetUsd: this.config.maxBudgetUsd } : {}),
          ...(existingSdkSessionId ? { resume: existingSdkSessionId } : {}),
        },
      });

      let finalResult: string | undefined;

      for await (const msg of stream) {
        if (msg.session_id && !sdkSessionId) {
          sdkSessionId = msg.session_id;
          this.sessionMap.set(sessionId, sdkSessionId);
          savePersistedSessionMap(this.sessionMap);
        }
        if (msg.type === 'assistant') rounds++;
        bridge(msg);
        if (msg.type === 'result' && (msg as any).subtype === 'success') {
          finalResult = (msg as any).result;
        }
      }

      conclusionText = finalResult || '';
      allFindings.push(extractFindingsFromText(conclusionText));
      const mergedFindings = mergeFindings(allFindings);

      sessionContext.addTurn(
        query,
        {
          primaryGoal: query,
          aspects: [],
          expectedOutputType: 'diagnosis',
          complexity: 'complex',
          followUpType: previousFindings.length > 0 ? 'extend' : 'initial',
        },
        {
          agentId: 'claude-agent',
          success: true,
          findings: mergedFindings,
          confidence: this.estimateConfidence(mergedFindings),
          message: conclusionText,
        },
        mergedFindings,
      );

      return {
        sessionId,
        success: true,
        findings: mergedFindings,
        hypotheses: [],
        conclusion: conclusionText,
        confidence: this.estimateConfidence(mergedFindings),
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
    }
  }

  reset(): void {
    this.sessionMap.clear();
  }

  private emitUpdate(update: StreamingUpdate): void {
    this.emit('update', update);
  }

  private collectPreviousFindings(sessionContext: any): Finding[] {
    try {
      const turns = sessionContext.getAllTurns?.() || [];
      return turns.flatMap((turn: any) => turn.findings || []);
    } catch {
      return [];
    }
  }

  private estimateConfidence(findings: Finding[]): number {
    if (findings.length === 0) return 0.3;
    const avg = findings.reduce((sum, f) => sum + (f.confidence ?? 0.5), 0) / findings.length;
    return Math.min(1, Math.max(0, avg));
  }

  /**
   * Capture entities (frames, sessions, etc.) from skill displayResults
   * and apply them to the EntityStore for multi-turn drill-down support.
   */
  private captureEntitiesFromSkillDisplayResults(
    displayResults: Array<{ stepId?: string; data?: any }>,
    entityStore: any,
  ): void {
    try {
      // Build a synthetic AgentToolResult data payload keyed by stepId
      const data: Record<string, any> = {};
      for (const dr of displayResults) {
        if (dr.stepId && dr.data) {
          data[dr.stepId] = dr.data;
        }
      }
      // Use existing capture pipeline via synthetic AgentResponse
      const captured = captureEntitiesFromResponses([{
        agentId: 'claude-agent',
        success: true,
        toolResults: [{ toolName: 'invoke_skill', data }],
      } as any]);
      applyCapturedEntities(entityStore, captured);
    } catch (err) {
      // Entity capture is non-critical — log and continue
      console.warn('[ClaudeRuntime] Entity capture failed:', (err as Error).message);
    }
  }
}
