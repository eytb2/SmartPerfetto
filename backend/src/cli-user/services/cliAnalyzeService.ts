// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * CLI Analyze Facade.
 *
 * Wraps agentv3's service layer into a single `runTurn()` call with no
 * Express dependency. This is the CLI's only touch-point with the agentv3
 * internals — everything else (commands, REPL, IO) depends on this facade.
 *
 * Compared to HTTP route's `runAgentDrivenAnalysis()`, this omits:
 *   - SSE broadcasting (no HTTP response)
 *   - conversation_step derivation (frontend-only concern)
 *   - scene reconstruction payload (deferred to PR-future)
 *   - LLM telemetry logging subscription (best-effort, not critical for CLI)
 *
 * It keeps:
 *   - prepareSession / analyze / conclusion capture
 *   - HTML report generation (written to CLI's session folder, not /api/reports)
 *   - sdkSessionId surfacing for subsequent resume
 */

import { AssistantApplicationService } from '../../assistant/application/assistantApplicationService';
import {
  AgentAnalyzeSessionService,
  type AnalyzeManagedSession,
} from '../../assistant/application/agentAnalyzeSessionService';
import { getTraceProcessorService } from '../../services/traceProcessorService';
import { createSessionLogger } from '../../services/sessionLogger';
import { SessionPersistenceService } from '../../services/sessionPersistenceService';
import { sessionContextManager } from '../../agent/context/enhancedSessionContext';
import { getHTMLReportGenerator } from '../../services/htmlReportGenerator';
import type { StreamingUpdate } from '../../agent/types';
import type { ModelRouter } from '../../agent';
import type { AnalysisResult } from '../../agent/core/orchestratorTypes';

export interface RunTurnInput {
  tracePath?: string;
  traceId?: string;
  query: string;
  sessionId?: string;
  /** Receives every StreamingUpdate from the orchestrator in real time. */
  onEvent: (update: StreamingUpdate) => void;
  /**
   * Fires once after `prepareSession` resolves, before `analyze()` starts
   * streaming events. Lets callers create the session folder + switch to
   * direct disk writes instead of buffering events in memory.
   */
  onSessionReady?: (sessionId: string) => void;
}

export interface RunTurnOutput {
  sessionId: string;
  traceId: string;
  sdkSessionId?: string;
  result: AnalysisResult;
  /** Absolute path to the generated HTML report, or undefined if generation failed. */
  reportHtml?: string;
  reportError?: string;
  model?: string;
}

/**
 * Singleton per CLI process.
 * - Own `AssistantApplicationService` — no HTTP routes touch it, so the 30-min
 *   idle cleanup (only scheduled from agentRoutes.ts) never runs.
 * - `SessionPersistenceService` writes to `backend/data/sessions/sessions.db`
 *   (the same DB the HTTP server uses — intentional, so REPL sessions are
 *   visible to the web UI and vice versa).
 */
export class CliAnalyzeService {
  private readonly appService = new AssistantApplicationService<AnalyzeManagedSession>();
  private readonly persistence: SessionPersistenceService;
  private readonly analyzeService: AgentAnalyzeSessionService<AnalyzeManagedSession>;

  constructor() {
    this.persistence = SessionPersistenceService.getInstance();
    this.analyzeService = new AgentAnalyzeSessionService<AnalyzeManagedSession>({
      assistantAppService: this.appService,
      // agentv3 path never calls into this — agentv2 fallback would. We throw
      // instead of returning a stub so a future wrong turn fails loudly.
      getModelRouter: (): ModelRouter => {
        throw new Error(
          'CliAnalyzeService: getModelRouter() invoked — agentv2 is not supported from the CLI. ' +
          'Ensure CLAUDE_AGENT_SDK / agentv3 is active (unset AI_SERVICE).',
        );
      },
      createSessionLogger,
      sessionPersistenceService: this.persistence,
      sessionContextManager,
      // Only invoked on resume; PR1 covers fresh analyze only. Returning null
      // lets prepareSession fall through to a new session rather than throw.
      buildRecoveredResultFromContext: () => null,
    });
  }

  async loadTrace(tracePath: string): Promise<string> {
    return getTraceProcessorService().loadTraceFromFilePath(tracePath);
  }

  /**
   * Resume-only path: try to reload an existing trace by its original id,
   * preserving identity so the persisted session's `traceId` still matches.
   * Returns true on success, false if the trace file has been evicted from
   * `uploads/traces/` (caller should then degrade to a fresh load).
   */
  async reloadTraceById(traceId: string): Promise<boolean> {
    const info = await getTraceProcessorService().getOrLoadTrace(traceId);
    return info !== undefined;
  }

  async runTurn(input: RunTurnInput): Promise<RunTurnOutput> {
    // Resolve traceId: either passed in (we assume caller already loaded), or load now.
    let traceId = input.traceId;
    if (!traceId) {
      if (!input.tracePath) {
        throw new Error('runTurn requires either tracePath or traceId');
      }
      traceId = await this.loadTrace(input.tracePath);
    }

    const { sessionId, session } = this.analyzeService.prepareSession({
      traceId,
      query: input.query,
      requestedSessionId: input.sessionId,
    });

    // Surface sessionId to the caller now, before analyze() starts emitting
    // events. Without this, callers must buffer events until runTurn resolves,
    // which accumulates the entire analyze run's output in memory.
    input.onSessionReady?.(sessionId);

    const orchestrator = session.orchestrator;

    // Subscribe to live updates. Wrap in off()-on-finally to avoid handler leaks
    // if runTurn is called multiple times within one CLI process (REPL path).
    const handler = (update: StreamingUpdate) => {
      try {
        input.onEvent(update);
      } catch (err) {
        // Don't let a renderer bug kill the analysis — log and continue.
        console.error('[CliAnalyzeService] onEvent handler threw:', (err as Error).message);
      }
    };
    orchestrator.on('update', handler);

    let result: AnalysisResult;
    try {
      result = await orchestrator.analyze(input.query, sessionId, traceId, {});
    } finally {
      orchestrator.off('update', handler);
    }

    // sdkSessionId is only populated on ClaudeRuntime (agentv3) — guarded call.
    const sdkSessionId =
      typeof orchestrator.getSdkSessionId === 'function'
        ? orchestrator.getSdkSessionId(sessionId)
        : undefined;

    const reportOutput = this.buildReportHtml(session, result);

    return {
      sessionId,
      traceId,
      sdkSessionId,
      result,
      reportHtml: reportOutput.html,
      reportError: reportOutput.error,
      // The Claude model name is stored on ClaudeRuntime's config; not trivially
      // exposed via IOrchestrator. Left undefined for PR1; fills in PR2 via
      // CLAUDE_MODEL env read if needed for config.json provenance.
      model: process.env.CLAUDE_MODEL,
    };
  }

  /**
   * Mirrors the report-building block in `agentRoutes.ts:runAgentDrivenAnalysis`
   * (lines ~3892-4002) but with only the fields the CLI actually produces.
   * The richer fields (agentDialogue, dataEnvelopes, conversationTimeline) are
   * populated by the HTTP handler's own update listener — CLI leaves them empty,
   * which the generator tolerates via optional properties.
   */
  private buildReportHtml(
    session: AnalyzeManagedSession,
    result: AnalysisResult,
  ): { html?: string; error?: string } {
    try {
      const traceInfo = getTraceProcessorService().getTrace(session.traceId);
      const traceStartNs = traceInfo?.metadata?.startTime;
      const timestamp = Date.now();

      const reportData = {
        traceId: session.traceId,
        query: session.query,
        traceStartNs:
          traceStartNs !== undefined && traceStartNs !== null ? String(traceStartNs) : undefined,
        result: {
          sessionId: session.sessionId,
          success: result.success,
          findings: result.findings,
          hypotheses: result.hypotheses,
          conclusion: result.conclusion,
          confidence: result.confidence,
          rounds: result.rounds,
          totalDurationMs: result.totalDurationMs,
        },
        hypotheses: result.hypotheses,
        dialogue: session.agentDialogue || [],
        conversationTimeline: session.conversationSteps || [],
        dataEnvelopes: session.dataEnvelopes || [],
        agentResponses: session.agentResponses || [],
        timestamp,
        conversationTurns: session.runSequence || 1,
        queryHistory: session.queryHistory || [
          { turn: 1, query: session.query, timestamp: session.createdAt },
        ],
        conclusionHistory: session.conclusionHistory || [
          {
            turn: 1,
            conclusion: result.conclusion,
            confidence: result.confidence,
            timestamp,
          },
        ],
      };

      const html = getHTMLReportGenerator().generateAgentDrivenHTML(reportData as any);
      return { html };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  /**
   * Best-effort teardown. Called by CLI on process exit to stop the
   * trace_processor_shell subprocess — otherwise Node waits on it.
   */
  async shutdown(): Promise<void> {
    try {
      await getTraceProcessorService().cleanup();
    } catch {
      /* ignore — already cleaned or never started */
    }
  }
}
