import {
  activateChannelInboundForAccount,
  activateChannelInboundForConnection,
  type MailInboundRuntimeResources,
} from './inbound';
import {
  defaultGmailChannelConfig,
  parseGmailChannelConfig,
  type GmailChannelConfig,
} from '../../mail-channel/gmail/config';
import { createPostgresMailSyncRepository } from '../../modules/mail-sync/postgres/sync-repository';
import { createChannelConfigRepository } from '../../integrations/core/channel-config-repository';
import { handleGmailWebhookRequest } from '../../mail-channel/gmail/inbound/webhook';
import { createGmailCredentialContext } from './gmail-credential-context';
import { createGmailPlugin } from '../../mail-channel/gmail/plugin';
import type { DB } from '../../db';

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

const createAdapter = async (
  db: DB,
  resources: MailInboundRuntimeResources,
  connectionId: string,
) => {
  const context = await createGmailCredentialContext(db, resources, connectionId);
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
  resources: MailInboundRuntimeResources,
  input: { connectionId: string; accountId: string },
): Promise<void> =>
  await activateChannelInboundForAccount(db, resources, {
    ...input,
    channelId: 'gmail',
  });

export const activateGmailInboundForConnection = async (
  db: DB,
  resources: MailInboundRuntimeResources,
  input: { connectionId: string },
): Promise<void> =>
  await activateChannelInboundForConnection(db, resources, {
    ...input,
    expectedChannelId: 'gmail',
  });

export const stopGmailWatchForConnection = async (
  db: DB,
  resources: MailInboundRuntimeResources,
  connectionId: string,
): Promise<void> => {
  const adapter = await createAdapter(db, resources, connectionId);
  if (!adapter.unsubscribe) {
    throw new Error('Gmail inbound adapter does not support Watch cancellation');
  }
  await adapter.unsubscribe();
};

export const handleGmailWebhookForEnvironment = async (
  db: DB,
  resources: MailInboundRuntimeResources,
  request: Request,
): Promise<Response> => {
  const repository = createPostgresMailSyncRepository(db);
  return await handleGmailWebhookRequest(request, {
    getChannelConfig: () => readGmailChannelConfig(db),
    recordSignal: (signal) => repository.recordSignal(signal),
    enqueueDiscover: (syncId) => resources.taskQueue.enqueueIngress({ type: 'discover', syncId }),
  });
};
