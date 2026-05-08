// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import express from 'express';
import request from 'supertest';

import { ENTERPRISE_FEATURE_FLAG_ENV } from '../../config';
import advancedAIRoutes from '../advancedAIRoutes';
import aiChatRoutes from '../aiChatRoutes';
import autoAnalysisRoutes from '../autoAnalysis';

const originalEnv = {
  enterprise: process.env[ENTERPRISE_FEATURE_FLAG_ENV],
  apiKey: process.env.SMARTPERFETTO_API_KEY,
  trustedHeaders: process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS,
};

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/agent/v1/llm', aiChatRoutes);
  app.use('/api/auto-analysis', autoAnalysisRoutes);
  app.use('/api/advanced-ai', advancedAIRoutes);
  return app;
}

describe('legacy AI enterprise guard', () => {
  let app: express.Express;

  beforeEach(() => {
    process.env[ENTERPRISE_FEATURE_FLAG_ENV] = 'true';
    delete process.env.SMARTPERFETTO_API_KEY;
    delete process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS;
    app = makeApp();
  });

  afterEach(() => {
    restoreEnvValue(ENTERPRISE_FEATURE_FLAG_ENV, originalEnv.enterprise);
    restoreEnvValue('SMARTPERFETTO_API_KEY', originalEnv.apiKey);
    restoreEnvValue('SMARTPERFETTO_SSO_TRUSTED_HEADERS', originalEnv.trustedHeaders);
  });

  it.each([
    ['POST', '/api/agent/v1/llm/chat'],
    ['POST', '/api/agent/v1/llm/completions'],
    ['POST', '/api/auto-analysis/analyze'],
    ['GET', '/api/auto-analysis/patterns'],
    ['POST', '/api/auto-analysis/enhance'],
    ['POST', '/api/advanced-ai/analyze'],
    ['GET', '/api/advanced-ai/learning/stats'],
  ])('returns disabled for %s %s in enterprise mode', async (method, path) => {
    const res = await request(app)
      [method.toLowerCase() as 'get' | 'post'](path)
      .send({})
      .expect(404);

    expect(res.body).toMatchObject({
      success: false,
      error: 'disabled_in_enterprise_mode',
      code: 'LEGACY_AI_DISABLED_IN_ENTERPRISE_MODE',
    });
  });
});
