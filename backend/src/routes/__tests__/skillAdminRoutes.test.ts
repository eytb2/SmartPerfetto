// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import express from 'express';
import request from 'supertest';

import { ENTERPRISE_FEATURE_FLAG_ENV } from '../../config';
import skillAdminRoutes from '../skillAdminRoutes';

const originalEnv = {
  enterprise: process.env[ENTERPRISE_FEATURE_FLAG_ENV],
  trustedHeaders: process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS,
  apiKey: process.env.SMARTPERFETTO_API_KEY,
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
  app.use('/api/admin', skillAdminRoutes);
  return app;
}

function adminHeaders(req: request.Test): request.Test {
  return req
    .set('X-SmartPerfetto-SSO-User-Id', 'admin-a')
    .set('X-SmartPerfetto-SSO-Email', 'admin-a@example.test')
    .set('X-SmartPerfetto-SSO-Tenant-Id', 'tenant-a')
    .set('X-SmartPerfetto-SSO-Workspace-Id', 'workspace-a')
    .set('X-SmartPerfetto-SSO-Roles', 'org_admin')
    .set('X-SmartPerfetto-SSO-Scopes', '*');
}

describe('skill admin enterprise guard', () => {
  let app: express.Express;

  beforeEach(() => {
    process.env[ENTERPRISE_FEATURE_FLAG_ENV] = 'true';
    process.env.SMARTPERFETTO_SSO_TRUSTED_HEADERS = 'true';
    delete process.env.SMARTPERFETTO_API_KEY;
    app = makeApp();
  });

  afterEach(() => {
    restoreEnvValue(ENTERPRISE_FEATURE_FLAG_ENV, originalEnv.enterprise);
    restoreEnvValue('SMARTPERFETTO_SSO_TRUSTED_HEADERS', originalEnv.trustedHeaders);
    restoreEnvValue('SMARTPERFETTO_API_KEY', originalEnv.apiKey);
  });

  it('disables custom skill write endpoints in enterprise mode', async () => {
    const create = await adminHeaders(request(app).post('/api/admin/skills'))
      .send({ yaml: 'name: custom_skill\nversion: "1"\nsteps: []\n' })
      .expect(404);
    expect(create.body).toMatchObject({
      error: 'disabled_in_enterprise_mode',
    });

    const update = await adminHeaders(request(app).put('/api/admin/skills/custom_skill'))
      .send({ yaml: 'name: custom_skill\nversion: "2"\nsteps: []\n' })
      .expect(404);
    expect(update.body).toMatchObject({
      error: 'disabled_in_enterprise_mode',
    });

    const remove = await adminHeaders(request(app).delete('/api/admin/skills/custom_skill'))
      .expect(404);
    expect(remove.body).toMatchObject({
      error: 'disabled_in_enterprise_mode',
    });
  });

  it('keeps non-writing validation available in enterprise mode', async () => {
    const validYaml = [
      'name: validation_only_skill',
      'version: "1"',
      'meta:',
      '  display_name: Validation Only Skill',
      '  description: Validates without persisting',
      'steps:',
      '  - id: rows',
      '    type: atomic',
      '    sql: SELECT 1 AS value',
      '',
    ].join('\n');

    const res = await adminHeaders(request(app).post('/api/admin/skills/validate'))
      .send({ yaml: validYaml })
      .expect(200);

    expect(res.body).toMatchObject({
      valid: true,
      errors: [],
    });
  });
});
