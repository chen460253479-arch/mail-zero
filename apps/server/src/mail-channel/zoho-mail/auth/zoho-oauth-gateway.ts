import { z } from 'zod';

import type { MailOAuthGateway, MailOAuthRuntimeConfig, MailOAuthTokens } from '../../oauth/types';
import { createZohoMailClient, resolveZohoMailBaseUrl } from '../shared/zoho-client';
import { createZohoMailTransport } from '../shared/zoho-transport';
import { zohoMailOAuthScopes } from '../metadata';
import { zohoDataCenters } from '../config';

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().positive().default(3600),
  scope: z.string().default(zohoMailOAuthScopes.join(',')),
});

const dataCenterSchema = z.enum(zohoDataCenters);

const dataCenter = (config: MailOAuthRuntimeConfig) =>
  dataCenterSchema.parse(config.providerConfig.dataCenter ?? 'com');

const accountOrigins = {
  com: 'https://accounts.zoho.com',
  eu: 'https://accounts.zoho.eu',
  in: 'https://accounts.zoho.in',
  'com.au': 'https://accounts.zoho.com.au',
  jp: 'https://accounts.zoho.jp',
  ca: 'https://accounts.zohocloud.ca',
  sa: 'https://accounts.zoho.sa',
} as const;

const accountOrigin = (config: MailOAuthRuntimeConfig): string =>
  accountOrigins[dataCenter(config)];

const readTokens = async (
  response: Response,
  fallbackRefreshToken?: string,
): Promise<MailOAuthTokens> => {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`ZOHO_OAUTH_HTTP_${response.status}`);
  const parsed = tokenSchema.parse(body);
  const refreshToken = parsed.refresh_token ?? fallbackRefreshToken;
  if (!refreshToken) throw new Error('ZOHO_REFRESH_TOKEN_MISSING');
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
) =>
  await readTokens(
    await fetch(`${accountOrigin(config)}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(30_000),
    }),
    fallbackRefreshToken,
  );

export class ZohoMailOAuthGateway implements MailOAuthGateway {
  createAuthorizationUrl(input: MailOAuthRuntimeConfig & { state: string }): string {
    const url = new URL(`${accountOrigin(input)}/oauth/v2/auth`);
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', zohoMailOAuthScopes.join(','));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async exchangeCode(config: MailOAuthRuntimeConfig, code: string) {
    return await tokenRequest(
      config,
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
      }),
    );
  }

  async refreshTokens(config: MailOAuthRuntimeConfig, refreshToken: string) {
    return await tokenRequest(
      config,
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      refreshToken,
    );
  }

  async resolveIdentity(config: MailOAuthRuntimeConfig, tokens: MailOAuthTokens) {
    return await createZohoMailClient(
      createZohoMailTransport(
        {
          type: 'oauth2',
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          scope: tokens.scope,
        },
        resolveZohoMailBaseUrl(dataCenter(config)),
      ),
    ).getMailboxContext();
  }

  async revokeToken(config: MailOAuthRuntimeConfig, token: string): Promise<void> {
    const url = new URL(`${accountOrigin(config)}/oauth/v2/token/revoke`);
    url.searchParams.set('token', token);
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ZOHO_OAUTH_REVOKE_HTTP_${response.status}`);
  }
}
