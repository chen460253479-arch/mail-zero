import { z } from 'zod';

import type { MailOAuthGateway, MailOAuthRuntimeConfig, MailOAuthTokens } from '../../oauth/types';
import { createMicrosoftGraphTransport } from '../shared/graph-transport';
import { createMicrosoftGraphClient } from '../shared/graph-client';
import { outlookOAuthScopes } from '../metadata';

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().positive().default(3600),
  scope: z.string().default(outlookOAuthScopes.join(' ')),
});

const tenantSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9.-]+$/iu);

const tenantId = (config: MailOAuthRuntimeConfig): string =>
  tenantSchema.parse(config.providerConfig.tenantId ?? 'common');

const endpoint = (config: MailOAuthRuntimeConfig, path: 'authorize' | 'token'): string =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenantId(config))}/oauth2/v2.0/${path}`;

const readTokenResponse = async (
  response: Response,
  fallbackRefreshToken?: string,
): Promise<MailOAuthTokens> => {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`MICROSOFT_OAUTH_HTTP_${response.status}`);
  const parsed = tokenSchema.parse(body);
  const refreshToken = parsed.refresh_token ?? fallbackRefreshToken;
  if (!refreshToken) throw new Error('MICROSOFT_REFRESH_TOKEN_MISSING');
  return {
    accessToken: parsed.access_token,
    refreshToken,
    expiresAt: new Date(Date.now() + parsed.expires_in * 1000),
    scope: parsed.scope,
  };
};

const tokenRequest = async (
  config: MailOAuthRuntimeConfig,
  body: URLSearchParams,
  fallbackRefreshToken?: string,
): Promise<MailOAuthTokens> =>
  await readTokenResponse(
    await fetch(endpoint(config, 'token'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(30_000),
    }),
    fallbackRefreshToken,
  );

export class MicrosoftOutlookOAuthGateway implements MailOAuthGateway {
  createAuthorizationUrl(input: MailOAuthRuntimeConfig & { state: string }): string {
    const url = new URL(endpoint(input, 'authorize'));
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', outlookOAuthScopes.join(' '));
    url.searchParams.set('state', input.state);
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  async exchangeCode(config: MailOAuthRuntimeConfig, code: string): Promise<MailOAuthTokens> {
    return await tokenRequest(
      config,
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        scope: outlookOAuthScopes.join(' '),
      }),
    );
  }

  async refreshTokens(
    config: MailOAuthRuntimeConfig,
    refreshToken: string,
  ): Promise<MailOAuthTokens> {
    return await tokenRequest(
      config,
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: outlookOAuthScopes.join(' '),
      }),
      refreshToken,
    );
  }

  async resolveIdentity(_config: MailOAuthRuntimeConfig, tokens: MailOAuthTokens) {
    return await createMicrosoftGraphClient(
      createMicrosoftGraphTransport({
        type: 'oauth2',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
      }),
    ).getIdentity();
  }

  async revokeToken(): Promise<void> {
    // Microsoft identity platform has no general OAuth token revocation endpoint.
    // Local deletion prevents further refreshes; tenant/user consent is managed by Microsoft.
  }
}
