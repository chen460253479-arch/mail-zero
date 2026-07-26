import { OAuth2Client } from 'google-auth-library';
import { people } from '@googleapis/people';
import { gmail } from '@googleapis/gmail';

import type { MailChannelIdentity, ResolvedCredential } from '../../contracts';
import type { GmailOAuthRuntimeConfig } from '../auth/types';
import type { GmailApiExecutor } from './api-transport';

const createAuth = (
  credential: ResolvedCredential,
  oauth?: GmailOAuthRuntimeConfig,
): OAuth2Client => {
  if (credential.type !== 'oauth2') {
    throw new Error('Gmail requires an OAuth2 credential');
  }
  const auth = oauth
    ? new OAuth2Client(oauth.clientId, oauth.clientSecret, oauth.redirectUri)
    : new OAuth2Client();
  auth.setCredentials({
    access_token: credential.accessToken,
    refresh_token: credential.refreshToken,
    expiry_date: credential.expiresAt?.getTime(),
    scope: credential.scope,
  });
  return auth;
};

export const createGoogleGmailApiExecutor = (
  credential: ResolvedCredential,
  oauth?: GmailOAuthRuntimeConfig,
): GmailApiExecutor => {
  const client = gmail({ version: 'v1', auth: createAuth(credential, oauth) });
  return {
    runGmailApi: async (operation) => await operation(client),
  };
};

export const resolveGoogleGmailIdentity = async (
  credential: ResolvedCredential,
): Promise<MailChannelIdentity> => {
  const auth = createAuth(credential);
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
};
