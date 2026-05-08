// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { EnterpriseOidcClient } from '../enterpriseOidcClient';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('EnterpriseOidcClient', () => {
  test('uses OIDC discovery, authorization URL, token exchange, and userinfo', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      calls.push({ url, init });
      if (url.endsWith('/.well-known/openid-configuration')) {
        return jsonResponse({
          issuer: 'https://idp.example.test',
          authorization_endpoint: 'https://idp.example.test/auth',
          token_endpoint: 'https://idp.example.test/token',
          userinfo_endpoint: 'https://idp.example.test/userinfo',
        });
      }
      if (url === 'https://idp.example.test/token') {
        expect(init?.method).toBe('POST');
        expect((init?.body as URLSearchParams).get('code')).toBe('code-123');
        return jsonResponse({ access_token: 'access-123', token_type: 'Bearer' });
      }
      if (url === 'https://idp.example.test/userinfo') {
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer access-123');
        return jsonResponse({
          sub: 'alice-sub',
          email: 'alice@example.test',
          name: 'Alice',
        });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;

    const client = new EnterpriseOidcClient({
      issuerUrl: 'https://idp.example.test',
      clientId: 'client-a',
      clientSecret: 'secret-a',
      redirectUri: 'https://smartperfetto.example.test/api/auth/oidc/callback',
      scopes: ['openid', 'email'],
    }, fetchImpl);

    const authorizationUrl = await client.buildAuthorizationUrl({
      state: 'state-123',
      nonce: 'nonce-123',
    });
    expect(authorizationUrl).toContain('https://idp.example.test/auth');
    expect(authorizationUrl).toContain('client_id=client-a');
    expect(authorizationUrl).toContain('state=state-123');

    const userInfo = await client.exchangeCodeForUserInfo('code-123');
    expect(userInfo).toMatchObject({
      issuer: 'https://idp.example.test',
      subject: 'alice-sub',
      email: 'alice@example.test',
      displayName: 'Alice',
    });
    expect(calls.map(call => call.url)).toEqual([
      'https://idp.example.test/.well-known/openid-configuration',
      'https://idp.example.test/token',
      'https://idp.example.test/userinfo',
    ]);
  });
});
