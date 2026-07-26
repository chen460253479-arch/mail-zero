import { eq } from 'drizzle-orm';

import { readGmailOAuthRuntimeConfig } from '../../modules/mail-accounts/application/connect-gmail-oauth';
import { createNangoCredentialRepository } from '../../modules/mail-accounts/credentials/nango';
import { resolveConnectionCredential } from '../../modules/mail-accounts/credentials/resolve';
import { createGoogleGmailApiExecutor } from '../../mail-channel/gmail/shared/google-api';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';
import type { GmailApiExecutor } from '../../mail-channel/gmail/shared/api-transport';
import { NangoIntegrationService } from '../../integrations/nango/service';
import { createCredentialAwareGmailExecutor } from './gmail-api-executor';
import type { ResolvedCredential } from '../../mail-channel/contracts';
import { authorizationBinding, connection } from '../../db/schema';
import { NangoClient } from '../../integrations/nango/client';
import type { ZeroEnv } from '../../env';
import type { DB } from '../../db';

export type GmailCredentialContext = {
  resolveCredential(forceRefresh: boolean): Promise<ResolvedCredential>;
  executor: GmailApiExecutor;
  markReconnectRequired(): Promise<void>;
};

const getAuthErrorCode = (error: unknown): string => {
  const candidate = error as {
    code?: string | number;
    response?: { status?: string | number };
  };
  return String(candidate.code ?? candidate.response?.status ?? '');
};

const findConnection = async (db: DB, connectionId: string) => {
  const [record] = await db
    .select({ connection, authorization: authorizationBinding })
    .from(connection)
    .leftJoin(authorizationBinding, eq(authorizationBinding.connectionId, connection.id))
    .where(eq(connection.id, connectionId))
    .limit(1);
  if (record === undefined) throw new Error('Mailbox connection was not found');
  if (record.connection.channelId !== 'gmail') {
    throw new Error(`Connection channel ${record.connection.channelId} is not Gmail`);
  }
  return record;
};

const createNangoResolver = async (db: DB, runtimeEnv: ZeroEnv) => {
  const service = new NangoIntegrationService({
    repository: createSystemIntegrationRepository(db),
    encryptionKey: runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
    createClient: (config) => new NangoClient({ ...config, fetch }),
    now: () => new Date(),
  });
  const config = await service.getRuntimeConfig();
  return {
    client: new NangoClient({ ...config, fetch }),
    repository: createNangoCredentialRepository(db),
  };
};

export const createGmailCredentialContext = async (
  db: DB,
  runtimeEnv: ZeroEnv,
  connectionId: string,
): Promise<GmailCredentialContext> => {
  const record = await findConnection(db, connectionId);
  const nango =
    record.authorization?.authSource === 'nango'
      ? await createNangoResolver(db, runtimeEnv)
      : undefined;
  const zeroOAuth =
    record.authorization?.authSource === 'zero_oauth'
      ? await readGmailOAuthRuntimeConfig({
          repository: createSystemIntegrationRepository(db),
          encryptionKey: runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
          redirectUri: `${runtimeEnv.VITE_PUBLIC_BACKEND_URL.replace(/\/+$/u, '')}/api/integrations/gmail/connect/callback`,
        })
      : undefined;
  const resolveCredential = async (forceRefresh: boolean) =>
    await resolveConnectionCredential(
      record,
      runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
      nango ? { nango: { ...nango, forceRefresh } } : {},
    );
  const markReconnectRequired = async (): Promise<void> => {
    await db
      .update(connection)
      .set({ status: 'reconnect_required', updatedAt: new Date() })
      .where(eq(connection.id, connectionId));
  };
  const executor = createCredentialAwareGmailExecutor({
    resolveCredential,
    createClient: (credential) => createGoogleGmailApiExecutor(credential, zeroOAuth),
    invalidateCredential: async () => {
      if (nango && record.authorization?.id) {
        await nango.repository.invalidate(record.authorization.id);
      }
    },
    markReconnectRequired,
    isUnauthorized: (error) => getAuthErrorCode(error) === '401',
  });

  return {
    resolveCredential,
    executor,
    markReconnectRequired,
  };
};
