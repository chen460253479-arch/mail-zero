import { eq } from 'drizzle-orm';

import { resolveChannelZeroOAuthCredential } from '../../modules/mail-accounts/credentials/channel-zero-oauth';
import { createNangoCredentialRepository } from '../../modules/mail-accounts/credentials/nango';
import { resolveConnectionCredential } from '../../modules/mail-accounts/credentials/resolve';
import type { MailChannelId, ResolvedCredential } from '../../mail-channel/contracts';
import type { NangoIntegrationService } from '../../integrations/nango/service';
import { authorizationBinding, connection } from '../../db/schema';
import type { ZeroEnv } from '../../env';
import type { DB } from '../../db';

export type MailChannelCredentialContext = {
  channelId: MailChannelId;
  authSource: 'zero_oauth' | 'nango' | 'manual';
  externalData: Record<string, unknown> | null;
  resolveCredential(forceRefresh: boolean): Promise<ResolvedCredential>;
  invalidateCredential(): Promise<void>;
  markReconnectRequired(): Promise<void>;
};

export type MailCredentialRuntimeResources = {
  environment: ZeroEnv;
  nango: Pick<NangoIntegrationService, 'initialize' | 'getConnection'>;
};

const credentialRefreshWindowMs = 15 * 60 * 1000;

export const canReuseResolvedCredential = (
  credential: ResolvedCredential,
  now = new Date(),
): boolean =>
  credential.type !== 'oauth2' ||
  credential.expiresAt === null ||
  credential.expiresAt.getTime() - now.getTime() > credentialRefreshWindowMs;

const findConnection = async (db: DB, connectionId: string) => {
  const [record] = await db
    .select({ connection, authorization: authorizationBinding })
    .from(connection)
    .leftJoin(authorizationBinding, eq(authorizationBinding.connectionId, connection.id))
    .where(eq(connection.id, connectionId))
    .limit(1);
  if (record === undefined) throw new Error('Mailbox connection was not found');
  if (record.authorization === null) throw new Error('Mailbox authorization is missing');
  return {
    connection: record.connection,
    authorization: record.authorization,
  };
};

const createNangoResolver = async (db: DB, service: MailCredentialRuntimeResources['nango']) => {
  await service.initialize();
  return {
    client: service,
    repository: createNangoCredentialRepository(db),
  };
};

export const createMailChannelCredentialContext = async (
  db: DB,
  resources: MailCredentialRuntimeResources,
  connectionId: string,
): Promise<MailChannelCredentialContext> => {
  const runtimeEnv = resources.environment;
  const record = await findConnection(db, connectionId);
  const nango =
    record.authorization.authSource === 'nango'
      ? await createNangoResolver(db, resources.nango)
      : undefined;
  let cachedCredential: ResolvedCredential | null = null;
  const resolveCredential = async (forceRefresh: boolean): Promise<ResolvedCredential> => {
    if (
      !forceRefresh &&
      cachedCredential !== null &&
      canReuseResolvedCredential(cachedCredential)
    ) {
      return cachedCredential;
    }
    let credential: ResolvedCredential;
    if (
      record.authorization.authSource === 'zero_oauth' &&
      (record.connection.channelId === 'outlook' || record.connection.channelId === 'zoho_mail')
    ) {
      credential = await resolveChannelZeroOAuthCredential(db, runtimeEnv, {
        bindingId: record.authorization.id,
        channelId: record.connection.channelId,
        encryptedCredentialSnapshot: record.authorization.encryptedCredentialSnapshot,
        accessTokenExpiresAt: record.authorization.accessTokenExpiresAt,
        forceRefresh,
      });
    } else {
      credential = await resolveConnectionCredential(
        record,
        runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
        nango ? { nango: { ...nango, forceRefresh } } : {},
      );
    }
    cachedCredential = credential;
    return credential;
  };

  return {
    channelId: record.connection.channelId,
    authSource: record.authorization.authSource,
    externalData: record.authorization.externalData,
    resolveCredential,
    invalidateCredential: async () => {
      cachedCredential = null;
      if (nango) {
        await nango.repository.invalidate(record.authorization.id);
      }
    },
    markReconnectRequired: async () => {
      await db
        .update(connection)
        .set({ status: 'reconnect_required', updatedAt: new Date() })
        .where(eq(connection.id, connectionId));
    },
  };
};
