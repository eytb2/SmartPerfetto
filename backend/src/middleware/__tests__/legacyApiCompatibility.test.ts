// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import express from 'express';
import request from 'supertest';
import {
  getLegacyApiUsageSnapshot,
  resetLegacyApiUsageTelemetryForTests,
} from '../../services/legacyApiTelemetry';
import { LEGACY_AGENT_API_SUNSET, markLegacyApi, rejectLegacyAgentApi } from '../legacyAgentApi';

describe('legacy API compatibility headers', () => {
  afterEach(() => {
    resetLegacyApiUsageTelemetryForTests();
  });

  test('adds deprecation headers and records telemetry before delegating to current handlers', async () => {
    const app = express();
    app.get(
      '/api/traces',
      markLegacyApi(
        '/api/workspaces/:workspaceId/traces',
        'Legacy trace API is deprecated. Migrate to workspace-scoped trace APIs',
      ),
      (_req, res) => res.json({ success: true }),
    );

    const res = await request(app)
      .get('/api/traces')
      .set('Authorization', 'Bearer test-token')
      .expect(200);

    expect(res.headers.deprecation).toBe('true');
    expect(res.headers.sunset).toBe(LEGACY_AGENT_API_SUNSET);
    expect(res.headers.link).toBe(
      '</api/workspaces/:workspaceId/traces>; rel="successor-version"',
    );
    expect(res.headers.warning).toContain('Legacy trace API is deprecated');
    expect(res.body).toEqual({ success: true });

    const telemetry = getLegacyApiUsageSnapshot();
    expect(telemetry.totalLegacyRequests).toBe(1);
    expect(telemetry.topPaths[0].key).toBe('GET /api/traces');
  });

  test('rejects removed legacy agent paths with mapped successors and telemetry', async () => {
    const app = express();
    app.use('/api/agent', rejectLegacyAgentApi);

    const res = await request(app)
      .post('/api/agent/llm/completions?debug=1')
      .set('Authorization', 'Bearer legacy-token')
      .send({ prompt: 'hello' })
      .expect(410);

    expect(res.headers.deprecation).toBe('true');
    expect(res.headers.sunset).toBe(LEGACY_AGENT_API_SUNSET);
    expect(res.headers.link).toBe('</api/agent/v1>; rel="successor-version"');
    expect(res.headers.warning).toContain('Legacy agent API has been removed');
    expect(res.body).toMatchObject({
      success: false,
      error: 'Legacy agent API has been removed',
      migration: {
        successor: '/api/agent/v1/llm/completions',
        root: '/api/agent/v1',
        llm: '/api/agent/v1/llm',
      },
    });

    const telemetry = getLegacyApiUsageSnapshot();
    expect(telemetry.totalLegacyRequests).toBe(1);
    expect(telemetry.topPaths[0].key).toBe('POST /api/agent/llm/completions');
    expect(telemetry.topAuthSubjects[0]?.authSubject).toMatch(/^bearer:/);
  });

  test('passes through the current /api/agent/v1 subtree when mounted at the legacy root', async () => {
    const app = express();
    app.use('/api/agent', rejectLegacyAgentApi);
    app.get('/api/agent/v1/status', (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .get('/api/agent/v1/status')
      .expect(200);

    expect(res.headers.deprecation).toBeUndefined();
    expect(res.body).toEqual({ ok: true });
    expect(getLegacyApiUsageSnapshot().totalLegacyRequests).toBe(0);
  });
});
