import { OAuth2Client } from 'google-auth-library';

import type { GmailChannelProviderConfig } from '../config';

export type GmailPushAuthenticationConfig = Required<GmailChannelProviderConfig>;

type TokenPayload = {
  iss?: unknown;
  aud?: unknown;
  email?: unknown;
  email_verified?: unknown;
};

type IdTokenVerifier = {
  verifyIdToken(input: {
    idToken: string;
    audience: string;
  }): Promise<{ payload: TokenPayload | undefined }>;
};

const defaultVerifier: IdTokenVerifier = {
  verifyIdToken: async (input) => {
    const ticket = await new OAuth2Client().verifyIdToken(input);
    return { payload: ticket.getPayload() };
  },
};

const bearerToken = (authorizationHeader: string | undefined): string | null => {
  if (authorizationHeader === undefined) return null;
  const match = /^Bearer ([^\s]+)$/u.exec(authorizationHeader.trim());
  return match?.[1] ?? null;
};

export const authenticateGmailPush = async (
  input: {
    authorizationHeader: string | undefined;
    subscriptionName: string | undefined;
  },
  config: GmailPushAuthenticationConfig,
  verifier: IdTokenVerifier = defaultVerifier,
): Promise<boolean> => {
  if (input.subscriptionName !== config.subscriptionName) return false;
  const token = bearerToken(input.authorizationHeader);
  if (token === null) return false;

  try {
    const { payload } = await verifier.verifyIdToken({
      idToken: token,
      audience: config.pushAudience,
    });
    return (
      payload !== undefined &&
      ['accounts.google.com', 'https://accounts.google.com'].includes(String(payload.iss)) &&
      payload.aud === config.pushAudience &&
      payload.email === config.pushServiceAccount &&
      payload.email_verified === true
    );
  } catch {
    return false;
  }
};
