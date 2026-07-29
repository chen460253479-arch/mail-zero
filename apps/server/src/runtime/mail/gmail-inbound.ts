import {
  defaultGmailChannelConfig,
  parseGmailChannelConfig,
  type GmailChannelConfig,
} from '../../mail-channel/gmail/config';
import { createPostgresMailSyncRepository } from '../../modules/mail-sync/postgres/sync-repository';
import { createChannelConfigRepository } from '../../integrations/core/channel-config-repository';
import { activateChannelInboundForAccount, activateChannelInboundForConnection } from './inbound';
import { handleGmailWebhookRequest } from '../../mail-channel/gmail/inbound/webhook';
import { createGmailCredentialContext } from './gmail-credential-context';
import { createGmailPlugin } from '../../mail-channel/gmail/plugin';
import { createDb, type DB } from '../../db';
import type { ZeroEnv } from '../../env';

const readGmailChannelConfig = async (db: DB): Promise<GmailChannelConfig> => {
  const record = await createChannelConfigRepository(db).get('gmail');
  if (record === null) return defaultGmailChannelConfig;
  return parseGmailChannelConfig({
    channelId: record.channelId,
    authSource: record.authSource,
    inboxWatchEnabled: record.inboxWatchEnabled,
    scheduledSyncEnabled: record.scheduledSyncEnabled,
    syncIntervalMinutes: record.syncIntervalMinutes,
    providerConfig: record.providerConfig,
  });
};

const createAdapter = async (db: DB, runtimeEnv: ZeroEnv, connectionId: string) => {
  const context = await createGmailCredentialContext(db, runtimeEnv, connectionId);
  return await createGmailPlugin({
    createExecutor: async () => context.executor,
    resolveIdentity: async () => {
      throw new Error('Identity resolution is not available in the inbound runtime');
    },
  }).inbound!.createAdapter({
    connectionId,
    credential: await context.resolveCredential(false),
  });
};

export const activateGmailInboundForAccount = async (
  db: DB,
  runtimeEnv: ZeroEnv,
  input: { connectionId: string; accountId: string },
): Promise<void> =>
  await activateChannelInboundForAccount(db, runtimeEnv, {
    ...input,
    channelId: 'gmail',
  });

export const activateGmailInboundForConnection = async (
  runtimeEnv: ZeroEnv,
  input: { connectionId: string },
): Promise<void> =>
  await activateChannelInboundForConnection(runtimeEnv, {
    ...input,
    expectedChannelId: 'gmail',
  });

export const stopGmailWatchForConnection = async (
  db: DB,
  runtimeEnv: ZeroEnv,
  connectionId: string,
): Promise<void> => {
  const adapter = await createAdapter(db, runtimeEnv, connectionId);
  if (!adapter.unsubscribe) {
    throw new Error('Gmail inbound adapter does not support Watch cancellation');
  }
  await adapter.unsubscribe();
};

export const handleGmailWebhookForEnvironment = async (
  runtimeEnv: ZeroEnv,
  request: Request,
): Promise<Response> => {
  const { db, conn } = createDb(runtimeEnv.HYPERDRIVE.connectionString);
  try {
    const repository = createPostgresMailSyncRepository(db);
    return await handleGmailWebhookRequest(request, {
      getChannelConfig: () => readGmailChannelConfig(db),
      recordSignal: (signal) => repository.recordSignal(signal),
      enqueueDiscover: (syncId) => runtimeEnv.MAIL_INGRESS_QUEUE.send({ type: 'discover', syncId }),
    });
  } finally {
    await conn.end();
  }
};
