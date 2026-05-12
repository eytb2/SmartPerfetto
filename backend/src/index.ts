import dotenv from 'dotenv';
// Load environment variables FIRST before importing routes
dotenv.config(
  process.env.SMARTPERFETTO_ENV_FILE
    ? { path: process.env.SMARTPERFETTO_ENV_FILE, override: true }
    : { override: true },
);

import { installEpipeGuard } from './utils/epipeGuard';

import express from 'express';
import cors from 'cors';
import path from 'path';

// Import configuration
import { resolveFeatureConfig, serverConfig } from './config';

// Import routes (now after dotenv.config())
import sqlRoutes from './routes/sql';
import simpleTraceRoutes from './routes/simpleTraceRoutes';
import perfettoLocalRoutes from './routes/perfettoLocalRoutes';
import aiChatRoutes from './routes/aiChatRoutes';
import autoAnalysisRoutes from './routes/autoAnalysis';
import sessionRoutes from './routes/sessionRoutes';
import perfettoSqlRoutes from './routes/perfettoSqlRoutes';
import exportRoutes from './routes/exportRoutes';
import templateAnalysisRoutes from './routes/templateAnalysisRoutes';
import skillRoutes from './routes/skillRoutes';
import skillAdminRoutes from './routes/skillAdminRoutes';
import strategyAdminRoutes from './routes/strategyAdminRoutes';
import reportRoutes from './routes/reportRoutes';
import agentRoutes from './routes/agentRoutes';
import advancedAIRoutes from './routes/advancedAIRoutes';
import providerRoutes from './routes/providerRoutes';
import flamegraphRoutes from './routes/flamegraphRoutes';
import criticalPathRoutes from './routes/criticalPathRoutes';
import baselineRoutes from './routes/baselineRoutes';
import ciGateRoutes from './routes/ciGateRoutes';
import memoryRoutes from './routes/memoryRoutes';
import caseRoutes from './routes/caseRoutes';
import ragAdminRoutes from './routes/ragAdminRoutes';
import enterpriseAuthRoutes from './routes/enterpriseAuthRoutes';
import enterpriseApiKeyRoutes from './routes/enterpriseApiKeyRoutes';
import enterpriseTenantRoutes from './routes/enterpriseTenantRoutes';
import enterpriseRuntimeDashboardRoutes from './routes/enterpriseRuntimeDashboardRoutes';
import analysisResultRoutes from './routes/analysisResultRoutes';
import workspaceWindowRoutes from './routes/workspaceWindowRoutes';
import traceProcessorProxyRoutes, { handleTraceProcessorProxyUpgrade } from './routes/traceProcessorProxyRoutes';
import {authenticate} from './middleware/auth';
import {
  assertTraceAnalysisConfiguredForStartup,
  getTraceAnalysisConfigurationStatus,
} from './services/traceAnalysisSkill';
import {
  getClaudeRuntimeDiagnostics,
} from './agentv3/claudeConfig';
import {
  getOpenAIRuntimeDiagnostics,
} from './agentOpenAI';
import { resolveAgentRuntimeSelection } from './agentRuntime';
import { collectEnvCredentialSources } from './agentRuntime/envCredentialSources';
import { getProviderService } from './services/providerManager';
import {
  getLegacyApiUsageSnapshot,
} from './services/legacyApiTelemetry';
import {
  AGENT_API_V1_BASE,
  AGENT_API_V1_LLM_BASE,
  LEGACY_AGENT_API_BASE,
  markLegacyApi,
  rejectLegacyAgentApi,
} from './middleware/legacyAgentApi';
import {
  bindWorkspaceRouteContext,
  requireWorkspaceRouteContext,
} from './middleware/workspaceRouteContext';

// Import cleanup utilities
import { TraceProcessorFactory, killOrphanProcessors } from './services/workingTraceProcessor';
import { getPortPool, resetPortPool } from './services/portPool';
import { failInterruptedAnalysisRunsOnStartup } from './services/analysisRunStore';
import { getSmartPerfettoVersion } from './version';

const app = express();
const PORT = serverConfig.port;
const NODE_ENV = serverConfig.nodeEnv;
const workspaceRouteContextMiddleware: express.RequestHandler[] = [
  bindWorkspaceRouteContext,
  authenticate,
  requireWorkspaceRouteContext,
];

// Fail fast for trace-analysis-specific credentials when strict startup validation is enabled.
assertTraceAnalysisConfiguredForStartup();

// Middleware — dynamic CORS: allow any origin whose port is 10000 (Perfetto frontend)
app.use(cors({
  origin: (requestOrigin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => {
    // No Origin header (server-to-server, curl, etc.) → allow
    if (!requestOrigin) return callback(null, true);
    try {
      const url = new URL(requestOrigin);
      if (url.port === '10000') {
        return callback(null, true);
      }
    } catch { /* malformed origin → block */ }
    callback(new Error(`CORS blocked: ${requestOrigin}`));
  },
  credentials: true,
}));

app.use(express.json({ limit: serverConfig.bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: serverConfig.bodyLimit }));

// Health check endpoint
app.get('/health', (req, res) => {
  const runtimeSelection = resolveAgentRuntimeSelection();
  const providerSvc = getProviderService();
  const activeProvider = providerSvc.list().find(p => p.isActive);
  const selectedProviderId = runtimeSelection.source === 'provider'
    ? runtimeSelection.providerId
    : null;
  const claudeDiagnostics = getClaudeRuntimeDiagnostics(
    runtimeSelection.kind === 'claude-agent-sdk' ? selectedProviderId : null,
  );
  const openAIDiagnostics = getOpenAIRuntimeDiagnostics(
    runtimeSelection.kind === 'openai-agents-sdk' ? selectedProviderId : null,
  );
  const selectedDiagnostics = runtimeSelection.kind === 'openai-agents-sdk'
    ? openAIDiagnostics
    : claudeDiagnostics;
  const envSources = collectEnvCredentialSources(process.env, 'health');
  const providerOverridesEnv = runtimeSelection.source === 'provider' && envSources.length > 0;

  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    version: getSmartPerfettoVersion(),
    traceAnalysis: getTraceAnalysisConfigurationStatus(),
    aiEngine: {
      runtime: runtimeSelection.kind,
      model: selectedDiagnostics.model,
      providerMode: selectedDiagnostics.providerMode,
      configured: selectedDiagnostics.configured,
      source: runtimeSelection.source,
      credentialSource: runtimeSelection.source === 'provider'
        ? 'provider-manager'
        : 'env-or-default',
      envCredentialSources: envSources,
      providerOverridesEnv,
      ...(activeProvider ? {
        activeProvider: {
          id: activeProvider.id,
          name: activeProvider.name,
          type: activeProvider.type,
        },
      } : {}),
      authRequired: !!process.env.SMARTPERFETTO_API_KEY
        || process.env.SMARTPERFETTO_ENTERPRISE === 'true'
        || !!process.env.SMARTPERFETTO_OIDC_ISSUER_URL,
      diagnostics: selectedDiagnostics,
    },
  });
});

// Debug endpoint to check env vars
app.get('/debug', (req, res) => {
  const legacyUsage = getLegacyApiUsageSnapshot(10);
  res.json({
    hasDeepSeekKey: !!process.env.DEEPSEEK_API_KEY,
    deepSeekBaseUrl: process.env.DEEPSEEK_BASE_URL,
    deepSeekModel: process.env.DEEPSEEK_MODEL,
    cwd: process.cwd(),
    legacyAgentApiUsage: legacyUsage,
  });
});

// API routes
app.use('/api/sql', sqlRoutes);
app.use('/api/auth', enterpriseAuthRoutes);
app.use('/api/auth', enterpriseApiKeyRoutes);
app.use('/api/tenant', enterpriseTenantRoutes);
app.use(
  '/api/workspaces/:workspaceId/traces',
  ...workspaceRouteContextMiddleware,
  simpleTraceRoutes,
);
app.use(
  '/api/workspaces/:workspaceId/reports',
  ...workspaceRouteContextMiddleware,
  reportRoutes,
);
app.use(
  '/api/workspaces/:workspaceId/agent',
  ...workspaceRouteContextMiddleware,
  agentRoutes,
);
app.use(
  '/api/workspaces/:workspaceId/providers',
  ...workspaceRouteContextMiddleware,
  providerRoutes,
);
app.use(
  '/api/workspaces/:workspaceId/analysis-results',
  ...workspaceRouteContextMiddleware,
  analysisResultRoutes,
);
app.use(
  '/api/workspaces/:workspaceId/windows',
  ...workspaceRouteContextMiddleware,
  workspaceWindowRoutes,
);
app.use(
  '/api/traces',
  markLegacyApi(
    '/api/workspaces/:workspaceId/traces',
    'Legacy trace API is deprecated. Migrate to workspace-scoped trace APIs',
  ),
  simpleTraceRoutes,
);
app.use(
  AGENT_API_V1_LLM_BASE,
  markLegacyApi(
    '/api/workspaces/:workspaceId/agent/llm',
    'Legacy agent LLM API is deprecated. Migrate to workspace-scoped agent APIs',
  ),
  aiChatRoutes,
);
app.use('/api/perfetto', perfettoLocalRoutes);
app.use('/api/auto-analysis', autoAnalysisRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/perfetto-sql', perfettoSqlRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/template-analysis', templateAnalysisRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api/admin/runtime', enterpriseRuntimeDashboardRoutes);
app.use('/api/admin', skillAdminRoutes);
app.use('/api/admin', strategyAdminRoutes);
app.use(
  '/api/reports',
  markLegacyApi(
    '/api/workspaces/:workspaceId/reports',
    'Legacy report API is deprecated. Migrate to workspace-scoped report APIs',
  ),
  reportRoutes,
);
app.use(
  AGENT_API_V1_BASE,
  markLegacyApi(
    '/api/workspaces/:workspaceId/agent',
    'Legacy agent API is deprecated. Migrate to workspace-scoped agent APIs',
  ),
  agentRoutes,
);
app.use('/api/advanced-ai', advancedAIRoutes);
app.use(
  '/api/v1/providers',
  markLegacyApi(
    '/api/workspaces/:workspaceId/providers',
    'Legacy provider API is deprecated. Migrate to workspace-scoped provider APIs',
  ),
  providerRoutes,
);
app.use('/api/flamegraph', flamegraphRoutes);
app.use('/api/critical-path', criticalPathRoutes);
app.use('/api/baselines', baselineRoutes);
app.use('/api/ci', authenticate, ciGateRoutes);
app.use('/api/tp', traceProcessorProxyRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/rag', ragAdminRoutes);
app.use(LEGACY_AGENT_API_BASE, rejectLegacyAgentApi);

const assistantShellDir = path.resolve(__dirname, '../public/assistant-shell');
app.get('/assistant-shell', (_req, res) => {
  res.sendFile(path.join(assistantShellDir, 'index.html'));
});
app.use('/assistant-shell', express.static(assistantShellDir));

const adminControlPlaneDir = path.resolve(__dirname, '../public/admin-control-plane');
app.get('/admin-control-plane', (_req, res) => {
  res.sendFile(path.join(adminControlPlaneDir, 'index.html'));
});
app.use('/admin-control-plane', express.static(adminControlPlaneDir));

// Serve uploaded files in development
if (NODE_ENV === 'development') {
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);

  res.status(err.status || 500).json({
    error: 'Internal server error',
    message: NODE_ENV === 'development' ? err.message : 'Something went wrong',
    ...(NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Initialize services
function recoverInterruptedEnterpriseRuns(): void {
  if (!resolveFeatureConfig().enterprise) return;
  try {
    const recovered = failInterruptedAnalysisRunsOnStartup();
    if (recovered.length > 0) {
      console.warn(
        `[EnterpriseRecovery] Marked ${recovered.length} interrupted analysis run(s) failed after backend startup`,
      );
    }
  } catch (error: any) {
    console.warn('[EnterpriseRecovery] Failed to recover interrupted analysis runs:', error?.message || error);
  }
}

recoverInterruptedEnterpriseRuns();

// Kill orphan trace_processor processes from previous runs
killOrphanProcessors();

// Graceful shutdown handler
function gracefulShutdown(signal: string) {
  console.log(`\n📴 Received ${signal}, shutting down gracefully...`);

  // Cleanup all trace processors (this will also release ports)
  console.log('🧹 Cleaning up trace processors...');
  TraceProcessorFactory.cleanup();

  // Reset port pool
  console.log('🔌 Resetting port pool...');
  resetPortPool();

  console.log('✅ Cleanup complete, exiting...');
  process.exit(0);
}

// Register signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// EPIPE guard: prevent stdout/stderr/uncaughtException EPIPE from crashing the server.
// Non-EPIPE uncaught exceptions still trigger graceful shutdown.
installEpipeGuard((error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${NODE_ENV}`);
  console.log(`🔗 API URL: http://localhost:${PORT}/api`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Stats: http://localhost:${PORT}/api/traces/stats`);
});

server.on('upgrade', (req, socket, head) => {
  if (handleTraceProcessorProxyUpgrade(req, socket, head)) return;
  socket.destroy();
});

// Handle server close
server.on('close', () => {
  console.log('🔒 Server closed');
});
