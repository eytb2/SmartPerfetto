// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import express from 'express';
import request from 'supertest';
import {
  getLegacyApiUsageSnapshot,
  resetLegacyApiUsageTelemetryForTests,
} from '../../services/legacyApiTelemetry';
import { LEGACY_AGENT_API_SUNSET, markLegacyApi } from '../legacyAgentApi';

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
});
