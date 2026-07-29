import { eq, sql } from 'drizzle-orm';

import {
  decryptCredential,
  encryptCredential,
} from '../../../infrastructure/security/credential-encryption';
import {
  readChannelOAuthRuntimeConfig,
  type ZeroOAuthChannelId,
} from '../application/connect-channel-oauth';
import { readChannelOAuthProviderConfig } from '../application/channel-oauth-provider-config';
import { createSystemIntegrationRepository } from '../../../integrations/core/repository';
import { createZeroOAuthSnapshot, readZeroOAuthSnapshot } from './zero-oauth';
import { getMailOAuthGateway } from '../../../mail-channel/oauth/providers';
import type { OAuth2Credential } from '../../../mail-channel/contracts';
import { authorizationBinding } from '../../../db/schema';
import type { ZeroEnv } from '../../../env';
import type { DB } from '../../../db';

const REFRESH_WINDOW_MS = 15 * 60_000;

export class ChannelOAuthCredentialError extends Error {
  readonly status = 401;

  constructor(
    readonly code: 'CHANNEL_OAUTH_REFRESH_FAILED' | 'CHANNEL_OAUTH_BINDING_MISSING',
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'ChannelOAuthCredentialError';
  }
}

const integrationKeys = {
  outlook: 'outlook_zero_oauth',
  zoho_mail: 'zoho_mail_zero_oauth',
} as const;

const redirectUri = (runtimeEnv: ZeroEnv, channelId: ZeroOAuthChannelId): string =>
  `${runtimeEnv.VITE_PUBLIC_BACKEND_URL.replace(/\/+$/u, '')}/api/integrations/${channelId}/connect/callback`;

const readCredential = async (
  encryptedSnapshot: string | null,
  expiresAt: Date | null,
  encryptionKey: string,
): Promise<OAuth2Credential> => {
  if (!encryptedSnapshot) {
    throw new ChannelOAuthCredentialError('CHANNEL_OAUTH_BINDING_MISSING');
  }
  const snapshot = readZeroOAuthSnapshot(await decryptCredential(encryptedSnapshot, encryptionKey));
  return { ...snapshot, expiresAt };
};

const shouldRefresh = (credential: OAuth2Credential, now: Date): boolean =>
  credential.expiresAt === null ||
  credential.expiresAt.getTime() - now.getTime() <= REFRESH_WINDOW_MS;

export const resolveChannelZeroOAuthCredential = async (
  db: DB,
  runtimeEnv: ZeroEnv,
  input: {
    bindingId: string;
    channelId: ZeroOAuthChannelId;
    encryptedCredentialSnapshot: string | null;
    accessTokenExpiresAt: Date | null;
    forceRefresh: boolean;
  },
): Promise<OAuth2Credential> => {
  const now = new Date();
  const cached = await readCredential(
    input.encryptedCredentialSnapshot,
    input.accessTokenExpiresAt,
    runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
  );
  if (!input.forceRefresh && !shouldRefresh(cached, now)) return cached;

  try {
    return await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.bindingId}, 0))`,
      );
      const binding = await transaction.query.authorizationBinding.findFirst({
        where: eq(authorizationBinding.id, input.bindingId),
      });
      if (!binding || binding.authSource !== 'zero_oauth') {
        throw new ChannelOAuthCredentialError('CHANNEL_OAUTH_BINDING_MISSING');
      }
      const latest = await readCredential(
        binding.encryptedCredentialSnapshot,
        binding.accessTokenExpiresAt,
        runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
      );
      if (!input.forceRefresh && !shouldRefresh(latest, now)) return latest;

      const providerConfig = await readChannelOAuthProviderConfig(db, input.channelId);
      const config = await readChannelOAuthRuntimeConfig({
        repository: createSystemIntegrationRepository(db),
        integrationKey: integrationKeys[input.channelId],
        encryptionKey: runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
        redirectUri: redirectUri(runtimeEnv, input.channelId),
        providerConfig,
      });
      const refreshed = await getMailOAuthGateway(input.channelId).refreshTokens(
        config,
        latest.refreshToken ?? '',
      );
      const credential: OAuth2Credential = {
        type: 'oauth2',
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        scope: refreshed.scope,
      };
      await transaction
        .update(authorizationBinding)
        .set({
          encryptedCredentialSnapshot: await encryptCredential(
            createZeroOAuthSnapshot({
              accessToken: credential.accessToken,
              refreshToken: credential.refreshToken ?? '',
              scope: credential.scope,
            }),
            runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
          ),
          accessTokenExpiresAt: credential.expiresAt,
          credentialFetchedAt: now,
          updatedAt: now,
        })
        .where(eq(authorizationBinding.id, input.bindingId));
      return credential;
    });
  } catch (error) {
    if (
      !input.forceRefresh &&
      cached.expiresAt !== null &&
      cached.expiresAt.getTime() > now.getTime()
    ) {
      return cached;
    }
    if (error instanceof ChannelOAuthCredentialError) throw error;
    throw new ChannelOAuthCredentialError('CHANNEL_OAUTH_REFRESH_FAILED', {
      cause: error,
    });
  }
};
