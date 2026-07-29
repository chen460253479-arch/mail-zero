import type { BlobStore, Id, MailAccountId, MailboxId } from '@zero/mail-core';
import { and, eq, isNull } from 'drizzle-orm';
import { ulid } from 'ulid';

import {
  createMailIngressRuntime,
  dispatchDueMailSyncWork,
  processMailIngressCommand,
  type MailIngressRuntime,
} from '../../modules/mail-sync/runtime/create-mail-sync';
import {
  createCredentialAwareOutlookClient,
  createCredentialAwareZohoMailClient,
} from './channel-api-clients';
import type {
  IngressScope,
  VersionedProviderState,
} from '../../modules/mail-sync/domain/ingress-adapter';
import {
  defaultGmailChannelConfig,
  parseGmailChannelConfig,
} from '../../mail-channel/gmail/config';
import { createPostgresMailSyncRepository } from '../../modules/mail-sync/postgres/sync-repository';
import { bootstrapLocalMailAccount } from '../../modules/mail-sync/application/bootstrap-account';
import { createChannelConfigRepository } from '../../integrations/core/channel-config-repository';
import { PostgresMailUnitOfWork } from '../../modules/mail/postgres/postgres-unit-of-work';
import { encryptCredential } from '../../infrastructure/security/credential-encryption';
import type { MailIngressCommand } from '../../modules/mail-sync/application/commands';
import { activateInboundSync } from '../../modules/mail-sync/application/activate';
import type { MailCredentialRuntimeResources } from './channel-credential-context';
import { createMailChannelCredentialContext } from './channel-credential-context';
import { connection, inboundSync, mailAccount, mailbox } from '../../db/schema';
import { createGmailCredentialContext } from './gmail-credential-context';
import { createMailChannelRegistry } from '../../mail-channel/registry';
import { createImapSmtpPluginForEnvironment } from './protocol-channel';
import { createChannelInboundAdapterFactory } from './channel-inbound';
import { createGmailPlugin } from '../../mail-channel/gmail/plugin';
import { createZohoMailPlugin } from '../../mail-channel/zoho-mail';
import { createZohoSubscriptionTarget } from './zoho-webhook-setup';
import type { MailChannelId } from '../../mail-channel/contracts';
import { createOutlookPlugin } from '../../mail-channel/outlook';
import { preprocessEmailHtml } from '../../lib/email-processor';
import { createMailCoreRuntime } from '../../modules/mail';
import type { MailTaskQueuePort } from './task-queue';
import type { ZeroEnv } from '../../env';
import type { DB } from '../../db';

const INBOX_SCOPE: IngressScope = {
  version: 1,
  mailboxRoles: ['inbox'],
  initialSync: 'none',
};

const DEFAULT_SYNC_INTERVAL_MINUTES = 10;
const OUTLOOK_SUBSCRIPTION_LIFETIME_MS = 2 * 24 * 60 * 60_000;

type ChannelSyncSettings = {
  inboxWatchEnabled: boolean;
  scheduledSyncEnabled: boolean;
  syncIntervalMinutes: number;
  providerConfig: Record<string, unknown>;
};

export type MailInboundRuntimeResources = MailCredentialRuntimeResources & {
  blobStore: BlobStore;
  taskQueue: MailTaskQueuePort;
};

const readChannelSyncSettings = async (
  db: DB,
  channelId: MailChannelId,
): Promise<ChannelSyncSettings> => {
  const record = await createChannelConfigRepository(db).get(channelId);
  if (record === null) {
    if (channelId === 'gmail') return defaultGmailChannelConfig;
    return {
      inboxWatchEnabled: false,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
      providerConfig: {},
    };
  }
  if (channelId === 'gmail') {
    return parseGmailChannelConfig({
      channelId: record.channelId,
      authSource: record.authSource,
      inboxWatchEnabled: record.inboxWatchEnabled,
      scheduledSyncEnabled: record.scheduledSyncEnabled,
      syncIntervalMinutes: record.syncIntervalMinutes,
      providerConfig: record.providerConfig,
    });
  }
  return {
    inboxWatchEnabled: record.inboxWatchEnabled,
    scheduledSyncEnabled: record.scheduledSyncEnabled,
    syncIntervalMinutes: record.syncIntervalMinutes,
    providerConfig: record.providerConfig,
  };
};

const createMailCore = (db: DB, resources: MailInboundRuntimeResources) =>
  createMailCoreRuntime({
    db,
    blobStore: resources.blobStore,
    blobReadAuditSink: { record: async () => undefined },
    clock: { now: () => new Date() },
    idFactory: {
      next<Kind extends string>() {
        return ulid() as Id<Kind>;
      },
    },
    sanitizeHtml: preprocessEmailHtml,
    cursorSigningKey: resources.environment.BETTER_AUTH_SECRET,
    notificationsEnabled: resources.environment.MAIL_WEBHOOK_ENABLED === 'true',
  });

const resolveConnectionId = async (db: DB, accountId: string): Promise<string> => {
  const rows = await db
    .select({ connectionId: mailAccount.connectionId })
    .from(mailAccount)
    .where(eq(mailAccount.id, accountId))
    .limit(1);
  const connectionId = rows[0]?.connectionId;
  if (connectionId === undefined) {
    throw new Error('Local mail account was not found');
  }
  return connectionId;
};

const resolveImportContext = async (db: DB, syncId: string) => {
  const rows = await db
    .select({
      accountId: inboundSync.accountId,
      connectionId: mailAccount.connectionId,
      provider: inboundSync.provider,
      scope: inboundSync.scope,
      inboxMailboxId: mailbox.id,
    })
    .from(inboundSync)
    .innerJoin(mailAccount, eq(mailAccount.id, inboundSync.accountId))
    .innerJoin(
      mailbox,
      and(
        eq(mailbox.mailAccountId, inboundSync.accountId),
        eq(mailbox.role, 'inbox'),
        isNull(mailbox.deletedAt),
      ),
    )
    .where(eq(inboundSync.id, syncId))
    .limit(1);
  const context = rows[0];
  if (context === undefined) {
    throw new Error('Mail sync import context was not found');
  }
  return {
    ...context,
    accountId: context.accountId as MailAccountId,
    inboxMailboxId: context.inboxMailboxId as MailboxId,
  };
};

const resolveSyncContext = async (
  db: DB,
  syncId: string,
): Promise<{ provider: MailChannelId; accountId: string }> => {
  const record = await db.query.inboundSync.findFirst({
    where: eq(inboundSync.id, syncId),
    columns: { provider: true, accountId: true },
  });
  if (record === undefined) throw new Error('Mail sync was not found');
  return {
    provider: record.provider as MailChannelId,
    accountId: record.accountId,
  };
};

const createOutlookSubscriptionTarget = async (
  runtimeEnv: ZeroEnv,
  now: Date,
): Promise<VersionedProviderState> => {
  const webhookUrl = `${runtimeEnv.VITE_PUBLIC_BACKEND_URL.replace(/\/+$/u, '')}/api/webhooks/mail/outlook`;
  const clientState =
    crypto.randomUUID().replace(/-/gu, '') + crypto.randomUUID().replace(/-/gu, '');
  return {
    version: 1,
    notificationUrl: webhookUrl,
    lifecycleNotificationUrl: webhookUrl,
    clientState,
    encryptedClientState: await encryptCredential(
      clientState,
      runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
    ),
    establishedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OUTLOOK_SUBSCRIPTION_LIFETIME_MS).toISOString(),
  };
};

const resolveSubscriptionTarget = async (
  db: DB,
  runtimeEnv: ZeroEnv,
  channelId: MailChannelId,
  now: Date,
  accountId: string,
): Promise<VersionedProviderState | null> => {
  const settings = await readChannelSyncSettings(db, channelId);
  if (!settings.inboxWatchEnabled) return null;
  if (channelId === 'gmail') {
    const topicName = settings.providerConfig.topicName;
    if (typeof topicName !== 'string') {
      throw new Error('Gmail Inbox Watch topic is not configured');
    }
    return { version: 1, topicName };
  }
  if (channelId === 'outlook') {
    return await createOutlookSubscriptionTarget(runtimeEnv, now);
  }
  if (channelId === 'zoho_mail') {
    return await createZohoSubscriptionTarget(runtimeEnv, accountId, now);
  }
  return null;
};

const createInboundAdapterRuntime = (db: DB, resources: MailInboundRuntimeResources) => {
  const runtimeEnv = resources.environment;
  const contexts = new Map<string, ReturnType<typeof createMailChannelCredentialContext>>();
  const getContext = (connectionId: string) => {
    const existing = contexts.get(connectionId);
    if (existing !== undefined) return existing;
    const created = createMailChannelCredentialContext(db, resources, connectionId);
    contexts.set(connectionId, created);
    return created;
  };
  const gmailContexts = new Map<string, ReturnType<typeof createGmailCredentialContext>>();
  const getGmailContext = (connectionId: string) => {
    const existing = gmailContexts.get(connectionId);
    if (existing !== undefined) return existing;
    const created = getContext(connectionId).then((context) =>
      createGmailCredentialContext(db, resources, connectionId, context),
    );
    gmailContexts.set(connectionId, created);
    return created;
  };
  const registry = createMailChannelRegistry([
    createGmailPlugin({
      createExecutor: async ({ connectionId }) => {
        if (connectionId === undefined) {
          throw new Error('Gmail inbound requires a connection ID');
        }
        return (await getGmailContext(connectionId)).executor;
      },
      resolveIdentity: async () => {
        throw new Error('Identity resolution is not available in the inbound runtime');
      },
    }),
    createOutlookPlugin({
      createClient: async ({ connectionId }) => {
        if (connectionId === undefined) {
          throw new Error('Outlook inbound requires a connection ID');
        }
        return createCredentialAwareOutlookClient(await getContext(connectionId));
      },
    }),
    createZohoMailPlugin({
      createClient: async ({ connectionId }) => {
        if (connectionId === undefined) {
          throw new Error('Zoho Mail inbound requires a connection ID');
        }
        return await createCredentialAwareZohoMailClient(db, await getContext(connectionId));
      },
    }),
    createImapSmtpPluginForEnvironment(runtimeEnv),
  ]);
  return {
    registry,
    adapterFactory: createChannelInboundAdapterFactory(registry, getContext),
  };
};

export const activateChannelInboundForAccount = async (
  db: DB,
  resources: MailInboundRuntimeResources,
  input: {
    connectionId: string;
    accountId: string;
    channelId: MailChannelId;
  },
): Promise<void> => {
  const runtimeEnv = resources.environment;
  const adapterRuntime = createInboundAdapterRuntime(db, resources);
  adapterRuntime.registry.getInbound(input.channelId);
  await activateInboundSync(
    {
      accountId: input.accountId,
      connectionId: input.connectionId,
      provider: input.channelId,
      scopeKey: 'inbox',
      scope: INBOX_SCOPE,
      subscriptionTarget: await resolveSubscriptionTarget(
        db,
        runtimeEnv,
        input.channelId,
        new Date(),
        input.accountId,
      ),
    },
    {
      adapterFactory: adapterRuntime.adapterFactory,
      repository: createPostgresMailSyncRepository(db),
    },
  );
};

export const activateChannelInboundForConnection = async (
  db: DB,
  resources: MailInboundRuntimeResources,
  input: { connectionId: string; expectedChannelId?: MailChannelId },
): Promise<void> => {
  const connectionRecord = await db.query.connection.findFirst({
    where: eq(connection.id, input.connectionId),
  });
  if (connectionRecord === undefined) {
    throw new Error('Mail connection was not found');
  }
  if (
    input.expectedChannelId !== undefined &&
    connectionRecord.channelId !== input.expectedChannelId
  ) {
    throw new Error(`Mail connection is not ${input.expectedChannelId}`);
  }
  const unitOfWork = new PostgresMailUnitOfWork(db);
  const mailCore = createMailCore(db, resources);
  const account = await bootstrapLocalMailAccount(
    {
      userId: connectionRecord.userId,
      connectionId: connectionRecord.id,
    },
    {
      findByConnectionId: (connectionId) =>
        unitOfWork.run((tx) => tx.accounts.findByConnectionId(connectionId)),
      createAccount: (createInput) => mailCore.createAccount(createInput),
    },
  );
  await activateChannelInboundForAccount(db, resources, {
    accountId: account.id,
    connectionId: connectionRecord.id,
    channelId: connectionRecord.channelId,
  });
};

const createRuntime = (db: DB, resources: MailInboundRuntimeResources): MailIngressRuntime => {
  const runtimeEnv = resources.environment;
  const taskQueue = resources.taskQueue;
  const repository = createPostgresMailSyncRepository(db);
  const adapterRuntime = createInboundAdapterRuntime(db, resources);
  const enqueue = (command: MailIngressCommand) => taskQueue.enqueueIngress(command);
  const getAdapterFactory = (provider: string) => {
    adapterRuntime.registry.getInbound(provider);
    return adapterRuntime.adapterFactory;
  };

  return createMailIngressRuntime({
    repository,
    getAdapterFactory,
    resolveConnectionId: (accountId) => resolveConnectionId(db, accountId),
    resolveImportContext: (syncId) => resolveImportContext(db, syncId),
    resolveSubscriptionTarget: async (syncId) => {
      const context = await resolveSyncContext(db, syncId);
      return await resolveSubscriptionTarget(
        db,
        runtimeEnv,
        context.provider,
        new Date(),
        context.accountId,
      );
    },
    resolveReconcileAfterMs: async (syncId) => {
      const context = await resolveSyncContext(db, syncId);
      const settings = await readChannelSyncSettings(db, context.provider);
      return settings.syncIntervalMinutes * 60_000;
    },
    mailCore: createMailCore(db, resources),
    onAuthenticationError: async ({ syncId, errorCode, errorMessage }) => {
      await db
        .update(inboundSync)
        .set({
          status: 'auth_error',
          lastErrorCode: errorCode,
          lastErrorMessage: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(inboundSync.id, syncId));
    },
    enqueue,
    newLeaseOwner: () => crypto.randomUUID(),
    clock: { now: () => new Date() },
  });
};

export const runMailIngressCommand = async (
  db: DB,
  resources: MailInboundRuntimeResources,
  command: MailIngressCommand,
): Promise<void> => {
  await processMailIngressCommand(command, createRuntime(db, resources));
};

export const enqueueDueMailIngressWork = async (
  db: DB,
  resources: MailInboundRuntimeResources,
): Promise<{ reconciliations: number; renewals: number; imports: number }> => {
  const now = new Date();
  return await dispatchDueMailSyncWork(
    {
      owner: crypto.randomUUID(),
      limit: 100,
      claimLeaseForMs: 30_000,
      confirmedLeaseForMs: 120_000,
      retryAfterMs: 5_000,
      reconcileBefore: now,
      renewalBefore: new Date(now.getTime() + 24 * 60 * 60_000),
      importBefore: now,
    },
    {
      repository: createPostgresMailSyncRepository(db),
      enqueue: (command) => resources.taskQueue.enqueueIngress(command),
    },
  );
};
