// backend/src/routes/providerRoutes.ts
// SPDX-License-Identifier: AGPL-3.0-or-later

import express from 'express';
import { getProviderService, officialTemplates } from '../services/providerManager';
import type { AgentRuntimeKind, ProviderCreateInput, ProviderScope, ProviderUpdateInput } from '../services/providerManager';
import { testProviderConnection } from '../services/providerManager/connectionTester';
import { authenticate, requireRequestContext } from '../middleware/auth';

const router = express.Router();

router.use(authenticate);

function providerScopeForRequest(req: express.Request): ProviderScope {
  const context = requireRequestContext(req);
  return {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    userId: context.userId,
  };
}

router.get('/', (req, res) => {
  const svc = getProviderService();
  res.json({ success: true, providers: svc.list(providerScopeForRequest(req)) });
});

router.get('/templates', (_req, res) => {
  res.json({ success: true, templates: officialTemplates });
});

router.get('/effective', (req, res) => {
  const svc = getProviderService();
  const scope = providerScopeForRequest(req);
  const env = svc.getEffectiveEnv(scope);
  if (env) {
    const active = svc.list(scope).find(p => p.isActive);
    res.json({ success: true, source: 'provider-manager', provider: active, env: maskEnvKeys(env) });
  } else {
    res.json({ success: true, source: 'env-fallback', provider: null });
  }
});

router.get('/:id', (req, res) => {
  const svc = getProviderService();
  const provider = svc.get(req.params.id, providerScopeForRequest(req));
  if (!provider) return res.status(404).json({ success: false, error: 'Provider not found' });
  res.json({ success: true, provider });
});

router.post('/', (req, res) => {
  try {
    const svc = getProviderService();
    const input: ProviderCreateInput = req.body;
    const scope = providerScopeForRequest(req);
    const provider = svc.create(input, scope);
    res.status(201).json({ success: true, provider: svc.get(provider.id, scope) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const svc = getProviderService();
    const input: ProviderUpdateInput = req.body;
    const scope = providerScopeForRequest(req);
    svc.update(req.params.id, input, scope);
    res.json({ success: true, provider: svc.get(req.params.id, scope) });
  } catch (err: any) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const svc = getProviderService();
    svc.delete(req.params.id, providerScopeForRequest(req));
    res.json({ success: true });
  } catch (err: any) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/deactivate', (req, res) => {
  const svc = getProviderService();
  svc.deactivateAll(providerScopeForRequest(req));
  res.json({ success: true });
});

router.post('/:id/activate', (req, res) => {
  try {
    const svc = getProviderService();
    svc.activate(req.params.id, providerScopeForRequest(req));
    res.json({ success: true });
  } catch (err: any) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/:id/runtime', (req, res) => {
  try {
    const svc = getProviderService();
    const runtime = req.body?.agentRuntime as AgentRuntimeKind | undefined;
    if (runtime !== 'claude-agent-sdk' && runtime !== 'openai-agents-sdk') {
      return res.status(400).json({ success: false, error: 'Invalid agentRuntime' });
    }
    const scope = providerScopeForRequest(req);
    svc.switchAgentRuntime(req.params.id, runtime, scope);
    res.json({ success: true, provider: svc.get(req.params.id, scope) });
  } catch (err: any) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/:id/rotate-secret', (req, res) => {
  try {
    const svc = getProviderService();
    const scope = providerScopeForRequest(req);
    const secretVersion = svc.rotateSecret(req.params.id, scope);
    res.json({ success: true, secretVersion, provider: svc.get(req.params.id, scope) });
  } catch (err: any) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/:id/test', async (req, res) => {
  const svc = getProviderService();
  const provider = svc.getRaw(req.params.id, providerScopeForRequest(req));
  if (!provider) return res.status(404).json({ success: false, error: 'Provider not found' });

  const result = await testProviderConnection(provider);
  res.json({ success: true, result });
});

function maskEnvKeys(env: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  const sensitivePatterns = ['KEY', 'TOKEN', 'SECRET'];
  for (const [k, v] of Object.entries(env)) {
    if (sensitivePatterns.some(p => k.includes(p)) && v.length > 8) {
      masked[k] = `****${v.slice(-4)}`;
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

export default router;
