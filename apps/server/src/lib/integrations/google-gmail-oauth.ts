import { OAuth2Client } from 'google-auth-library';
import { people } from '@googleapis/people';
import { gmail } from '@googleapis/gmail';

import type {
  GmailOAuthGateway,
  GmailOAuthRuntimeConfig,
  GmailOAuthTokens,
} from './gmail-oauth-service';
import { gmailOAuthScopes } from '../mail-channel/gmail-metadata';

const createClient = (config: GmailOAuthRuntimeConfig): OAuth2Client =>
  new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);

export class GoogleGmailOAuthGateway implements GmailOAuthGateway {
  createAuthorizationUrl(input: GmailOAuthRuntimeConfig & { state: string }): string {
    return createClient(input).generateAuthUrl({
      access_type: 'offline',
      include_granted_scopes: true,
      prompt: 'consent',
      scope: [...gmailOAuthScopes],
      state: input.state,
    });
  }

  async exchangeCode(config: GmailOAuthRuntimeConfig, code: string): Promise<GmailOAuthTokens> {
    const { tokens } = await createClient(config).getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Google did not return the required OAuth tokens');
    }
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expiry_date ?? Date.now() + 3_600_000),
      scope: tokens.scope ?? gmailOAuthScopes.join(' '),
    };
  }

  async resolveIdentity(
    config: GmailOAuthRuntimeConfig,
    tokens: GmailOAuthTokens,
  ): Promise<{ email: string; name: string; picture: string }> {
    const auth = createClient(config);
    auth.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiresAt.getTime(),
      scope: tokens.scope,
    });
    const profile = await gmail({ version: 'v1', auth }).users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress ?? '';
    try {
      const person = await people({ version: 'v1', auth }).people.get({
        resourceName: 'people/me',
        personFields: 'names,photos',
      });
      return {
        email,
        name: person.data.names?.[0]?.displayName ?? '',
        picture: person.data.photos?.[0]?.url ?? '',
      };
    } catch {
      return { email, name: '', picture: '' };
    }
  }

  async revokeToken(config: GmailOAuthRuntimeConfig, token: string): Promise<void> {
    await createClient(config).revokeToken(token);
  }
}
