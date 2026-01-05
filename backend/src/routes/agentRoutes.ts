/**
 * Agent Analysis Routes
 *
 * API endpoints for Agent-based trace analysis (LLM-driven Think-Act loop)
 */

import express from 'express';
import { getTraceProcessorService } from '../services/traceProcessorService';
import {
  createOrchestrator,
  createScrollingExpertAgent,
  registerCoreTools,
  createLLMClient,
  StreamingUpdate,
  OrchestratorResult,
} from '../agent';

const router = express.Router();

// Track active Agent sessions for SSE
const activeSessions = new Map<string, {
  orchestrator: ReturnType<typeof createOrchestrator>;
  sseClients: express.Response[];
  result?: OrchestratorResult;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
}>();

// Initialize Agent tools once
let toolsRegistered = false;

function ensureToolsRegistered() {
  if (!toolsRegistered) {
    registerCoreTools();
    toolsRegistered = true;
    console.log('[AgentRoutes] Core tools registered');
  }
}

/**
 * POST /api/agent/analyze
 *
 * Start Agent-based analysis
 *
 * Body:
 * {
 *   "traceId": "uuid-of-trace",
 *   "query": "分析这个 trace 的滑动性能",
 *   "mode": "agent"  // optional, defaults to "agent"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "analysisId": "agent-xxx"
 * }
 */
router.post('/analyze', async (req, res) => {
  try {
    const { traceId, query } = req.body;

    if (!traceId) {
      return res.status(400).json({
        success: false,
        error: 'traceId is required',
      });
    }

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'query is required',
      });
    }

    // Verify trace exists
    const traceProcessorService = getTraceProcessorService();
    const trace = traceProcessorService.getTrace(traceId);
    if (!trace) {
      return res.status(404).json({
        success: false,
        error: 'Trace not found in backend',
        hint: 'Please upload the trace to the backend first',
        code: 'TRACE_NOT_UPLOADED',
      });
    }

    // Initialize tools
    ensureToolsRegistered();

    // Create LLM client and orchestrator
    const llm = createLLMClient();
    const orchestrator = createOrchestrator(llm);

    // Create and register experts
    const scrollingExpert = createScrollingExpertAgent(llm);
    scrollingExpert.setTraceProcessorService(traceProcessorService, traceId);
    orchestrator.registerExpert(scrollingExpert);
    orchestrator.setTraceProcessorService(traceProcessorService, traceId);

    // Generate analysis ID
    const analysisId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Store session
    activeSessions.set(analysisId, {
      orchestrator,
      sseClients: [],
      status: 'pending',
    });

    // Start analysis in background
    runAgentAnalysis(analysisId, query, traceId).catch((error) => {
      console.error(`[AgentRoutes] Analysis error for ${analysisId}:`, error);
      const session = activeSessions.get(analysisId);
      if (session) {
        session.status = 'failed';
        session.error = error.message;
        broadcastToClients(analysisId, {
          type: 'error',
          content: error.message,
          timestamp: Date.now(),
        });
      }
    });

    res.json({
      success: true,
      analysisId,
    });
  } catch (error: any) {
    console.error('[AgentRoutes] Analyze error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Agent analysis failed',
    });
  }
});

/**
 * GET /api/agent/:analysisId/stream
 *
 * SSE endpoint for real-time Agent updates
 *
 * Events:
 * - progress: Status update
 * - thought: Agent reasoning
 * - finding: Analysis finding
 * - conclusion: Final answer
 * - error: Error occurred
 * - end: Stream ended
 */
router.get('/:analysisId/stream', (req, res) => {
  const { analysisId } = req.params;

  const session = activeSessions.get(analysisId);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'Analysis session not found',
    });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial connection message
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ analysisId, timestamp: Date.now() })}\n\n`);

  // Add client to session
  session.sseClients.push(res);
  console.log(`[AgentRoutes] SSE client connected for ${analysisId}`);

  // If analysis is already completed, send the result
  if (session.status === 'completed' && session.result) {
    sendAgentResult(res, session.result);
    res.write(`event: end\n`);
    res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
    res.end();
    return;
  }

  // If analysis failed, send error
  if (session.status === 'failed') {
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ error: session.error, timestamp: Date.now() })}\n\n`);
    res.write(`event: end\n`);
    res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
    res.end();
    return;
  }

  // Handle client disconnect
  req.on('close', () => {
    console.log(`[AgentRoutes] SSE client disconnected for ${analysisId}`);
    const idx = session.sseClients.indexOf(res);
    if (idx !== -1) {
      session.sseClients.splice(idx, 1);
    }
  });

  // Keep-alive ping
  const keepAlive = setInterval(() => {
    try {
      res.write(`: keep-alive\n\n`);
    } catch {
      clearInterval(keepAlive);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
  });
});

/**
 * GET /api/agent/:analysisId/status
 *
 * Get analysis status (for polling)
 */
router.get('/:analysisId/status', (req, res) => {
  const { analysisId } = req.params;

  const session = activeSessions.get(analysisId);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'Analysis session not found',
    });
  }

  const response: any = {
    success: true,
    analysisId,
    status: session.status,
  };

  if (session.status === 'completed' && session.result) {
    response.result = {
      answer: session.result.synthesizedAnswer,
      confidence: session.result.confidence,
      executionTimeMs: session.result.executionTimeMs,
      findingsCount: session.result.expertResults.reduce(
        (sum, er) => sum + er.findings.length,
        0
      ),
    };
  }

  if (session.status === 'failed') {
    response.error = session.error;
  }

  res.json(response);
});

/**
 * DELETE /api/agent/:analysisId
 *
 * Clean up an analysis session
 */
router.delete('/:analysisId', (req, res) => {
  const { analysisId } = req.params;

  const session = activeSessions.get(analysisId);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'Analysis session not found',
    });
  }

  // Close all SSE connections
  session.sseClients.forEach((client) => {
    try {
      client.end();
    } catch {}
  });

  activeSessions.delete(analysisId);

  res.json({ success: true });
});

// ============================================================================
// Helper Functions
// ============================================================================

async function runAgentAnalysis(analysisId: string, query: string, traceId: string) {
  const session = activeSessions.get(analysisId);
  if (!session) return;

  session.status = 'running';

  const streamingCallback = (update: StreamingUpdate) => {
    console.log(`[AgentRoutes] Streaming update for ${analysisId}:`, update.type);
    broadcastToClients(analysisId, update);
  };

  try {
    const result = await session.orchestrator.handleQuery(query, traceId, {
      streamingCallback,
      maxExpertIterations: 5,
      confidenceThreshold: 0.7,
    });

    session.result = result;
    session.status = 'completed';

    // Send final result to all clients
    broadcastToClients(analysisId, {
      type: 'conclusion',
      content: result.synthesizedAnswer,
      timestamp: Date.now(),
    });

    // Send end event
    session.sseClients.forEach((client) => {
      try {
        sendAgentResult(client, result);
        client.write(`event: end\n`);
        client.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
      } catch {}
    });

    console.log(`[AgentRoutes] Analysis completed for ${analysisId}`);
  } catch (error: any) {
    session.status = 'failed';
    session.error = error.message;

    broadcastToClients(analysisId, {
      type: 'error',
      content: error.message,
      timestamp: Date.now(),
    });

    throw error;
  }
}

function broadcastToClients(analysisId: string, update: StreamingUpdate) {
  const session = activeSessions.get(analysisId);
  if (!session) return;

  const eventType = update.type === 'tool_call' ? 'tool_call' : update.type;
  const eventData = JSON.stringify({
    type: update.type,
    data: update.content,
    timestamp: update.timestamp,
  });

  session.sseClients.forEach((client) => {
    try {
      client.write(`event: ${eventType}\n`);
      client.write(`data: ${eventData}\n\n`);
    } catch {}
  });
}

function sendAgentResult(res: express.Response, result: OrchestratorResult) {
  // Send analysis_completed event with full result
  res.write(`event: analysis_completed\n`);
  res.write(`data: ${JSON.stringify({
    type: 'analysis_completed',
    data: {
      answer: result.synthesizedAnswer,
      confidence: result.confidence,
      executionTimeMs: result.executionTimeMs,
      intent: result.intent,
      findings: result.expertResults.flatMap((er) =>
        er.findings.map((f) => ({
          severity: f.severity,
          title: f.title,
          description: f.description,
        }))
      ),
      suggestions: result.expertResults.flatMap((er) => er.suggestions),
    },
    timestamp: Date.now(),
  })}\n\n`);
}

// Cleanup old sessions every 30 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeSessions.entries()) {
    // Parse timestamp from ID
    const match = id.match(/^agent-(\d+)-/);
    if (match) {
      const createdAt = parseInt(match[1], 10);
      if (now - createdAt > maxAge) {
        console.log(`[AgentRoutes] Cleaning up stale session: ${id}`);
        session.sseClients.forEach((client) => {
          try {
            client.end();
          } catch {}
        });
        activeSessions.delete(id);
      }
    }
  }
}, 30 * 60 * 1000);

export default router;
