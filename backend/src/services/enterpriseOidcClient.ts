// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

export interface OidcRuntimeConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string[];
}

interface OidcDiscoveryDocument {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  issuer?: string;
}

interface OidcTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  id_token?: string;
  [key: string]: unknown;
}

export interface EnterpriseOidcUserInfo {
  issuer: string;
  subject: string;
  email?: string;
  displayName?: string;
  claims: Record<string, unknown>;
}

export const OIDC_ENV = {
  issuerUrl: 'SMARTPERFETTO_OIDC_ISSUER_URL',
  clientId: 'SMARTPERFETTO_OIDC_CLIENT_ID',
  clientSecret: 'SMARTPERFETTO_OIDC_CLIENT_SECRET',
  redirectUri: 'SMARTPERFETTO_OIDC_REDIRECT_URI',
  scopes: 'SMARTPERFETTO_OIDC_SCOPES',
} as const;

function normalizeIssuerUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function discoveryUrlForIssuer(issuerUrl: string): string {
  const normalized = normalizeIssuerUrl(issuerUrl);
  if (normalized.endsWith('/.well-known/openid-configuration')) return normalized;
  return `${normalized}/.well-known/openid-configuration`;
}

export function resolveOidcRuntimeConfig(env: NodeJS.ProcessEnv = process.env): OidcRuntimeConfig | null {
  const issuerUrl = env[OIDC_ENV.issuerUrl]?.trim();
  const clientId = env[OIDC_ENV.clientId]?.trim();
  const redirectUri = env[OIDC_ENV.redirectUri]?.trim();
  if (!issuerUrl || !clientId || !redirectUri) return null;
  return {
    issuerUrl: normalizeIssuerUrl(issuerUrl),
    clientId,
    clientSecret: env[OIDC_ENV.clientSecret]?.trim() || undefined,
    redirectUri,
    scopes: (env[OIDC_ENV.scopes] || 'openid email profile')
      .split(/[,\s]+/)
      .map(scope => scope.trim())
      .filter(Boolean),
  };
}

export class EnterpriseOidcClient {
  private discovery: OidcDiscoveryDocument | null = null;

  constructor(
    private readonly config: OidcRuntimeConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): EnterpriseOidcClient | null {
    const config = resolveOidcRuntimeConfig(env);
    return config ? new EnterpriseOidcClient(config) : null;
  }

  async buildAuthorizationUrl(params: {
    state: string;
    nonce: string;
  }): Promise<string> {
    const discovery = await this.getDiscovery();
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('scope', this.config.scopes.join(' '));
    url.searchParams.set('state', params.state);
    url.searchParams.set('nonce', params.nonce);
    return url.toString();
  }

  async exchangeCodeForUserInfo(code: string): Promise<EnterpriseOidcUserInfo> {
    const discovery = await this.getDiscovery();
    if (!discovery.userinfo_endpoint) {
      throw new Error('OIDC discovery document is missing userinfo_endpoint');
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', this.config.redirectUri);
    body.set('client_id', this.config.clientId);
    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
    }

    const tokenResponse = await this.fetchImpl(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!tokenResponse.ok) {
      throw new Error(`OIDC token exchange failed with status ${tokenResponse.status}`);
    }
    const token = await tokenResponse.json() as OidcTokenResponse;
    if (!token.access_token || typeof token.access_token !== 'string') {
      throw new Error('OIDC token response did not include access_token');
    }

    const userInfoResponse = await this.fetchImpl(discovery.userinfo_endpoint, {
      headers: {
        authorization: `Bearer ${token.access_token}`,
      },
    });
    if (!userInfoResponse.ok) {
      throw new Error(`OIDC userinfo request failed with status ${userInfoResponse.status}`);
    }
    const claims = await userInfoResponse.json() as Record<string, unknown>;
    const subject = typeof claims.sub === 'string' ? claims.sub.trim() : '';
    if (!subject) {
      throw new Error('OIDC userinfo response did not include sub');
    }

    return {
      issuer: discovery.issuer || this.config.issuerUrl,
      subject,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      displayName: typeof claims.name === 'string' ? claims.name : undefined,
      claims,
    };
  }

  private async getDiscovery(): Promise<OidcDiscoveryDocument> {
    if (this.discovery) return this.discovery;
    const response = await this.fetchImpl(discoveryUrlForIssuer(this.config.issuerUrl));
    if (!response.ok) {
      throw new Error(`OIDC discovery failed with status ${response.status}`);
    }
    const parsed = await response.json() as OidcDiscoveryDocument;
    if (!parsed.authorization_endpoint || !parsed.token_endpoint) {
      throw new Error('OIDC discovery document is missing required endpoints');
    }
    this.discovery = parsed;
    return parsed;
  }
}
