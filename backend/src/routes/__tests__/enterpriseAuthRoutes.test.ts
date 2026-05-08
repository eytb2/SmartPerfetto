// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth';
import { createEnterpriseAuthRouter } from '../enterpriseAuthRoutes';
import { applyEnterpriseMinimalSchema } from '../../services/enterpriseSchema';
import { EnterpriseSsoService } from '../../services/enterpriseSsoService';
import type { EnterpriseOidcUserInfo } from '../../services/enterpriseOidcClient';

const originalEnterprise = process.env.SMARTPERFETTO_ENTERPRISE;
const originalCookieSecret = process.env.SMARTPERFETTO_SSO_COOKIE_SECRET;
const originalApiKey = process.env.SMARTPERFETTO_API_KEY;

function ssoUserId(issuer: string, subject: string): string {
  return `sso-${crypto.createHash('sha256').update(`${issuer}|${subject}`).digest('hex').slice(0, 20)}`;
}

function makeApp(service: EnterpriseSsoService, userInfo: EnterpriseOidcUserInfo): {
  app: express.Express;
  captured: { state?: string; nonce?: string };
} {
  const app = express();
  app.use(express.json());
  const captured: { state?: string; nonce?: string } = {};
  app.use('/api/auth', createEnterpriseAuthRouter({
    ssoService: service,
    oidcClient: {
      async buildAuthorizationUrl(params) {
        captured.state = params.state;
        captured.nonce = params.nonce;
        return `https://idp.example.test/auth?state=${params.state}&nonce=${params.nonce}`;
      },
      async exchangeCodeForUserInfo(code) {
        if (code !== 'code-123') throw new Error('unexpected code');
        return userInfo;
      },
    },
  }));
  app.get('/protected', authenticate, (req, res) => {
    res.json({ requestContext: (req as AuthenticatedRequest).requestContext });
  });
  return { app, captured };
}

function seedMemberships(db: Database.Database, userId: string): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO organizations (id, name, status, plan, created_at, updated_at)
    VALUES ('tenant-a', 'Tenant A', 'active', 'enterprise', ?, ?)
  `).run(now, now);
  db.prepare(`
    INSERT INTO workspaces (id, tenant_id, name, created_at, updated_at)
    VALUES
      ('workspace-a', 'tenant-a', 'Workspace A', ?, ?),
      ('workspace-b', 'tenant-a', 'Workspace B', ?, ?)
  `).run(now, now, now, now);
  db.prepare(`
    INSERT INTO users (id, tenant_id, email, display_name, idp_subject, created_at, updated_at)
    VALUES (?, 'tenant-a', 'alice@example.test', 'Alice', 'https://idp.example.test|alice-sub', ?, ?)
  `).run(userId, now, now);
  db.prepare(`
    INSERT INTO memberships (tenant_id, workspace_id, user_id, role, created_at)
    VALUES
      ('tenant-a', 'workspace-a', ?, 'analyst', ?),
      ('tenant-a', 'workspace-b', ?, 'workspace_admin', ?)
  `).run(userId, now, userId, now);
}

describe('enterprise auth routes', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.SMARTPERFETTO_ENTERPRISE = 'true';
    process.env.SMARTPERFETTO_SSO_COOKIE_SECRET = 'test-sso-cookie-secret-32-bytes';
    delete process.env.SMARTPERFETTO_API_KEY;
    EnterpriseSsoService.resetForTests();
    db = new Database(':memory:');
    applyEnterpriseMinimalSchema(db);
  });

  afterEach(() => {
    db.close();
    EnterpriseSsoService.resetForTests();
    if (originalEnterprise === undefined) {
      delete process.env.SMARTPERFETTO_ENTERPRISE;
    } else {
      process.env.SMARTPERFETTO_ENTERPRISE = originalEnterprise;
    }
    if (originalCookieSecret === undefined) {
      delete process.env.SMARTPERFETTO_SSO_COOKIE_SECRET;
    } else {
      process.env.SMARTPERFETTO_SSO_COOKIE_SECRET = originalCookieSecret;
    }
    if (originalApiKey === undefined) {
      delete process.env.SMARTPERFETTO_API_KEY;
    } else {
      process.env.SMARTPERFETTO_API_KEY = originalApiKey;
    }
  });

  test('runs OIDC callback into workspace-selection onboarding and audit, then authenticates selected workspace', async () => {
    const issuer = 'https://idp.example.test';
    const subject = 'alice-sub';
    const userInfo: EnterpriseOidcUserInfo = {
      issuer,
      subject,
      email: 'alice@example.test',
      displayName: 'Alice',
      claims: {
        sub: subject,
        email: 'alice@example.test',
        name: 'Alice',
        tenant_id: 'tenant-a',
      },
    };
    const userId = ssoUserId(issuer, subject);
    seedMemberships(db, userId);
    const service = new EnterpriseSsoService(db);
    EnterpriseSsoService.setInstanceForTests(service);
    const { app, captured } = makeApp(service, userInfo);

    const login = await request(app)
      .get('/api/auth/oidc/login?returnTo=/assistant-shell')
      .expect(302);
    expect(login.headers.location).toContain('https://idp.example.test/auth');
    expect(captured.state).toBeDefined();
    const stateCookie = login.headers['set-cookie'][0].split(';')[0];

    const callback = await request(app)
      .get(`/api/auth/oidc/callback?code=code-123&state=${captured.state}`)
      .set('Cookie', stateCookie)
      .expect(200);

    expect(callback.body).toMatchObject({
      success: true,
      status: 'needs_workspace_selection',
      tenantId: 'tenant-a',
      userId,
      returnTo: '/assistant-shell',
    });
    expect(callback.body.workspaces.map((workspace: any) => workspace.workspaceId)).toEqual([
      'workspace-a',
      'workspace-b',
    ]);
    expect(callback.body.accessToken).toMatch(/^sp_sso_/);

    const selected = await request(app)
      .post('/api/auth/onboarding/workspace')
      .set('Authorization', `Bearer ${callback.body.accessToken}`)
      .send({ workspaceId: 'workspace-b' })
      .expect(200);
    expect(selected.body).toMatchObject({
      success: true,
      status: 'ready',
      workspaceId: 'workspace-b',
    });

    const protectedRes = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${callback.body.accessToken}`)
      .expect(200);
    expect(protectedRes.body.requestContext).toMatchObject({
      authType: 'sso',
      tenantId: 'tenant-a',
      workspaceId: 'workspace-b',
      userId,
      roles: ['workspace_admin'],
      scopes: ['*'],
    });

    expect(service.listAuditEvents().map(event => event.action)).toEqual([
      'sso_login',
      'workspace_selected',
      'provider_default_resolved',
    ]);
  });

  test('returns needs_tenant_join when no tenant claim, domain mapping, or default tenant matches', async () => {
    const service = new EnterpriseSsoService(db);
    const { app, captured } = makeApp(service, {
      issuer: 'https://idp.example.test',
      subject: 'bob-sub',
      email: 'bob@unknown.test',
      claims: { sub: 'bob-sub', email: 'bob@unknown.test' },
    });

    const login = await request(app).get('/api/auth/oidc/login').expect(302);
    const stateCookie = login.headers['set-cookie'][0].split(';')[0];
    const callback = await request(app)
      .get(`/api/auth/oidc/callback?code=code-123&state=${captured.state}`)
      .set('Cookie', stateCookie)
      .expect(200);

    expect(callback.body).toMatchObject({
      success: true,
      status: 'needs_tenant_join',
    });
    expect(callback.body.accessToken).toBeUndefined();
    expect(service.listAuditEvents()).toEqual([]);
  });
});
