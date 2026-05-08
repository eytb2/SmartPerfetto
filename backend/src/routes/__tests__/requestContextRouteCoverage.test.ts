// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { afterEach, describe, expect, it } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { markLegacyApi } from '../../middleware/legacyAgentApi';
import reportRoutes from '../reportRoutes';
import traceRoutes from '../simpleTraceRoutes';

const originalApiKey = process.env.SMARTPERFETTO_API_KEY;

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/traces',
    markLegacyApi(
      '/api/workspaces/:workspaceId/traces',
      'Legacy trace API is deprecated. Migrate to workspace-scoped trace APIs',
    ),
    traceRoutes,
  );
  app.use(
    '/api/reports',
    markLegacyApi(
      '/api/workspaces/:workspaceId/reports',
      'Legacy report API is deprecated. Migrate to workspace-scoped report APIs',
    ),
    reportRoutes,
  );
  return app;
}

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.SMARTPERFETTO_API_KEY;
  } else {
    process.env.SMARTPERFETTO_API_KEY = originalApiKey;
  }
});

describe('RequestContext route coverage', () => {
  it('keeps trace health available through dev fallback', async () => {
    delete process.env.SMARTPERFETTO_API_KEY;

    const res = await request(makeApp()).get('/api/traces/health');

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
  });

  it('keeps trace health public when API key auth is configured', async () => {
    process.env.SMARTPERFETTO_API_KEY = 'test-secret';

    const res = await request(makeApp()).get('/api/traces/health');

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
  });

  it('applies RequestContext auth middleware to trace resource routes when API key auth is configured', async () => {
    process.env.SMARTPERFETTO_API_KEY = 'test-secret';

    const res = await request(makeApp()).get('/api/traces');

    expect(res.status).toBe(401);
    expect(res.headers.deprecation).toBe('true');
    expect(res.headers.sunset).toBeDefined();
    expect(res.body.error).toBe('Unauthorized');
  });

  it('applies RequestContext auth middleware to report routes when API key auth is configured', async () => {
    process.env.SMARTPERFETTO_API_KEY = 'test-secret';

    const res = await request(makeApp()).get('/api/reports/missing-report');

    expect(res.status).toBe(401);
    expect(res.headers.deprecation).toBe('true');
    expect(res.headers.sunset).toBeDefined();
    expect(res.body.error).toBe('Unauthorized');
  });
});
