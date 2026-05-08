// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import express from 'express';
import {
  EnterpriseOidcClient,
  type EnterpriseOidcUserInfo,
} from '../services/enterpriseOidcClient';
import {
  EnterpriseSsoService,
  enterpriseSsoCookies,
  type OnboardingResult,
} from '../services/enterpriseSsoService';

interface OidcClientLike {
  buildAuthorizationUrl(params: { state: string; nonce: string }): Promise<string>;
  exchangeCodeForUserInfo(code: string): Promise<EnterpriseOidcUserInfo>;
}

interface EnterpriseAuthRouteDeps {
  oidcClient?: OidcClientLike | null;
  ssoService?: EnterpriseSsoService;
}

function cookieHeader(name: string, value: string, options: {
  maxAgeSeconds?: number;
  path?: string;
  httpOnly?: boolean;
} = {}): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path || '/'}`,
    'SameSite=Lax',
  ];
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  return parts.join('; ');
}

function clearCookieHeader(name: string, path = '/'): string {
  return cookieHeader(name, '', { maxAgeSeconds: 0, path });
}

function tokenFromRequest(req: express.Request, service: EnterpriseSsoService): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  const cookies = req.headers.cookie?.split(';') || [];
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.trim().split('=');
    if (name === service.sessionCookieName) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function sendOnboardingResult(res: express.Response, service: EnterpriseSsoService, result: OnboardingResult): void {
  if (result.accessToken) {
    res.setHeader('Set-Cookie', cookieHeader(
      service.sessionCookieName,
      service.createSessionCookieValue(result.accessToken),
      { maxAgeSeconds: 8 * 60 * 60 },
    ));
  }
  res.json({ success: true, ...result });
}

export function createEnterpriseAuthRouter(deps: EnterpriseAuthRouteDeps = {}): express.Router {
  const router = express.Router();
  const getService = () => deps.ssoService || EnterpriseSsoService.getInstance();
  const oidcClient = deps.oidcClient === undefined
    ? EnterpriseOidcClient.fromEnv()
    : deps.oidcClient;

  router.get('/oidc/login', async (req, res) => {
    if (!oidcClient) {
      return res.status(404).json({
        success: false,
        error: 'OIDC is not configured',
      });
    }

    try {
      const service = getService();
      const statePayload = service.createStatePayload(
        typeof req.query.returnTo === 'string' ? req.query.returnTo : undefined,
      );
      const signedState = service.signStatePayload(statePayload);
      const authorizationUrl = await oidcClient.buildAuthorizationUrl({
        state: statePayload.state,
        nonce: statePayload.nonce,
      });
      res.setHeader('Set-Cookie', cookieHeader(
        service.stateCookieName,
        signedState,
        { maxAgeSeconds: 10 * 60, path: '/api/auth/oidc/callback' },
      ));
      return res.redirect(302, authorizationUrl);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start OIDC login',
      });
    }
  });

  router.get('/oidc/callback', async (req, res) => {
    if (!oidcClient) {
      return res.status(404).json({
        success: false,
        error: 'OIDC is not configured',
      });
    }
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const service = getService();
    const stateCookie = req.headers.cookie
      ?.split(';')
      .map(cookie => cookie.trim())
      .find(cookie => cookie.startsWith(`${enterpriseSsoCookies.state}=`))
      ?.slice(enterpriseSsoCookies.state.length + 1);
    const statePayload = service.verifyStatePayload(stateCookie ? decodeURIComponent(stateCookie) : undefined);
    if (!code || !statePayload || statePayload.state !== state) {
      return res.status(400).json({
        success: false,
        error: 'Invalid OIDC callback state',
      });
    }

    try {
      const userInfo = await oidcClient.exchangeCodeForUserInfo(code);
      const result = service.completeOidcLogin(userInfo);
      const cookies = [clearCookieHeader(service.stateCookieName, '/api/auth/oidc/callback')];
      if (result.accessToken) {
        cookies.push(cookieHeader(
          service.sessionCookieName,
          service.createSessionCookieValue(result.accessToken),
          { maxAgeSeconds: 8 * 60 * 60 },
        ));
      }
      res.setHeader('Set-Cookie', cookies);
      return res.json({
        success: true,
        ...result,
        returnTo: statePayload.returnTo,
      });
    } catch (error) {
      return res.status(502).json({
        success: false,
        error: error instanceof Error ? error.message : 'OIDC callback failed',
      });
    }
  });

  router.get('/session', (req, res) => {
    const service = getService();
    const session = service.getOnboardingSessionFromRequest(req);
    if (!session) {
      return res.json({ success: true, authenticated: false });
    }
    return res.json({
      success: true,
      authenticated: true,
      tenantId: session.tenantId,
      userId: session.userId,
      workspaceId: session.selectedWorkspaceId,
      status: session.selectedWorkspaceId ? 'ready' : 'needs_workspace_selection',
      expiresAt: session.expiresAt,
    });
  });

  router.post('/onboarding/workspace', (req, res) => {
    const service = getService();
    const accessToken = tokenFromRequest(req, service);
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!accessToken || !workspaceId) {
      return res.status(400).json({
        success: false,
        error: 'access token and workspaceId are required',
      });
    }
    return sendOnboardingResult(res, service, service.selectWorkspace(accessToken, workspaceId));
  });

  router.post('/logout', (req, res) => {
    const service = getService();
    const accessToken = tokenFromRequest(req, service);
    if (accessToken) service.revokeSession(accessToken);
    res.setHeader('Set-Cookie', clearCookieHeader(service.sessionCookieName));
    return res.json({ success: true });
  });

  return router;
}

export default createEnterpriseAuthRouter();
