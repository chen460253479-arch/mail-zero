import type { Id, MailAccountId, MailboxId } from '@zero/mail-core';
import { and, eq, isNull } from 'drizzle-orm';
import { ulid } from 'ulid';

import {
  createMailIngressRuntime,
  processMailIngressCommand,
  type MailIngressRuntime,
} from '../../modules/mail-sync/runtime/create-mail-sync';
import { createPostgresMailSyncRepository } from '../../modules/mail-sync/postgres/sync-repository';
import { bootstrapLocalMailAccount } from '../../modules/mail-sync/application/bootstrap-account';
import { PostgresMailUnitOfWork } from '../../modules/mail/postgres/postgres-unit-of-work';
import type { MailIngressCommand } from '../../modules/mail-sync/application/commands';
import type { IngressScope } from '../../modules/mail-sync/domain/ingress-adapter';
import { activateInboundSync } from '../../modules/mail-sync/application/activate';
import { connection, inboundSync, mailAccount, mailbox } from '../../db/schema';
import { handleGmailPush } from '../../mail-channel/gmail/inbound/handle-push';
import { createGmailCredentialContext } from './gmail-credential-context';
import { defaultMailChannelRegistry } from '../../mail-channel/registry';
import { createMailCoreRuntime, R2BlobStore } from '../../modules/mail';
import { createGmailPlugin } from '../../mail-channel/gmail/plugin';
import { preprocessEmailHtml } from '../../lib/email-processor';
import { readGmailInboundConfig } from './gmail-inbound-config';
import { createDb, type DB } from '../../db';
import type { ZeroEnv } from '../../env';

const INBOX_SCOPE: IngressScope = {
  version: 1,
  mailboxRoles: ['inbox'],
  initialSync: 'none',
};

const createAdapterFactory = (db: DB, runtimeEnv: ZeroEnv) => ({
  create: async (connectionId: string) => {
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
  },
});

const createMailCore = (db: DB, runtimeEnv: ZeroEnv) =>
  createMailCoreRuntime({
    db,
    blobStore: new R2BlobStore(runtimeEnv.THREADS_BUCKET),
    blobReadAuditSink: { record: async () => undefined },
    clock: { now: () => new Date() },
    idFactory: {
      next<Kind extends string>() {
        return ulid() as Id<Kind>;
      },
    },
    sanitizeHtml: preprocessEmailHtml,
    cursorSigningKey: runtimeEnv.BETTER_AUTH_SECRET,
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

export const activateGmailInboundForAccount = async (
  db: DB,
  runtimeEnv: ZeroEnv,
  input: { connectionId: string; accountId: string },
): Promise<void> => {
  await activateInboundSync(
    {
      accountId: input.accountId,
      connectionId: input.connectionId,
      provider: 'gmail',
      scopeKey: 'inbox',
      scope: INBOX_SCOPE,
      subscriptionTarget: {
        version: 1,
        topicName: readGmailInboundConfig(runtimeEnv).topicName,
      },
    },
    {
      adapterFactory: createAdapterFactory(db, runtimeEnv),
      repository: createPostgresMailSyncRepository(db),
    },
  );
};

export const activateGmailInboundForConnection = async (
  runtimeEnv: ZeroEnv,
  input: { connectionId: string },
): Promise<void> => {
  const { db, conn } = createDb(runtimeEnv.HYPERDRIVE.connectionString);
  try {
    const connectionRecord = await db.query.connection.findFirst({
      where: eq(connection.id, input.connectionId),
    });
    if (connectionRecord === undefined) {
      throw new Error('Gmail connection was not found');
    }
    const unitOfWork = new PostgresMailUnitOfWork(db);
    const mailCore = createMailCore(db, runtimeEnv);
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
    await activateGmailInboundForAccount(db, runtimeEnv, {
      accountId: account.id,
      connectionId: connectionRecord.id,
    });
  } finally {
    await conn.end();
  }
};

export const stopGmailWatchForConnection = async (
  db: DB,
  runtimeEnv: ZeroEnv,
  connectionId: string,
): Promise<void> => {
  const adapter = await createAdapterFactory(db, runtimeEnv).create(connectionId);
  if (!adapter.unsubscribe) {
    throw new Error('Gmail inbound adapter does not support Watch cancellation');
  }
  await adapter.unsubscribe();
};

const createRuntime = (db: DB, runtimeEnv: ZeroEnv): MailIngressRuntime => {
  const repository = createPostgresMailSyncRepository(db);
  const adapterFactory = createAdapterFactory(db, runtimeEnv);
  const adapterFactories = new Map([['gmail', adapterFactory]]);
  const mailCore = createMailCore(db, runtimeEnv);
  const enqueue = (command: MailIngressCommand) => runtimeEnv.MAIL_INGRESS_QUEUE.send(command);
  const getAdapterFactory = (provider: string) => {
    defaultMailChannelRegistry.getInbound(provider);
    const factory = adapterFactories.get(provider);
    if (!factory) throw new Error(`Inbound provider runtime is not configured: ${provider}`);
    return factory;
  };

  return createMailIngressRuntime({
    repository,
    getAdapterFactory,
    resolveConnectionId: (accountId) => resolveConnectionId(db, accountId),
    resolveImportContext: (syncId) => resolveImportContext(db, syncId),
    resolveSubscriptionTarget: async () => ({
      version: 1,
      topicName: readGmailInboundConfig(runtimeEnv).topicName,
    }),
    mailCore,
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
  runtimeEnv: ZeroEnv,
  command: MailIngressCommand,
): Promise<void> => {
  const { db, conn } = createDb(runtimeEnv.HYPERDRIVE.connectionString);
  try {
    await processMailIngressCommand(command, createRuntime(db, runtimeEnv));
  } finally {
    await conn.end();
  }
};

export const recordGmailPushSignal = async (
  runtimeEnv: ZeroEnv,
  payload: unknown,
): Promise<{ accepted: boolean; matched: number; queued: number }> => {
  const { db, conn } = createDb(runtimeEnv.HYPERDRIVE.connectionString);
  try {
    const repository = createPostgresMailSyncRepository(db);
    return await handleGmailPush(payload, {
      recordSignal: (signal) => repository.recordSignal(signal),
      enqueueDiscover: (syncId) => runtimeEnv.MAIL_INGRESS_QUEUE.send({ type: 'discover', syncId }),
    });
  } finally {
    await conn.end();
  }
};

export const enqueueDueMailIngressWork = async (
  runtimeEnv: ZeroEnv,
): Promise<{ reconciliations: number; renewals: number; imports: number }> => {
  const { db, conn } = createDb(runtimeEnv.HYPERDRIVE.connectionString);
  try {
    const repository = createPostgresMailSyncRepository(db);
    const now = Date.now();
    const reconciliations = await repository.findDueReconciliations({
      before: new Date(now - 5 * 60_000),
      limit: 100,
    });
    const renewals = await repository.findDueRenewals({
      before: new Date(now + 24 * 60 * 60_000),
      limit: 100,
    });
    const imports = await repository.findSyncsWithDueItems({
      before: new Date(now),
      limit: 100,
    });
    await Promise.all([
      ...reconciliations.map((syncId) =>
        runtimeEnv.MAIL_INGRESS_QUEUE.send({ type: 'reconcile', syncId }),
      ),
      ...renewals.map((syncId) => runtimeEnv.MAIL_INGRESS_QUEUE.send({ type: 'renew', syncId })),
      ...imports.map((syncId) => runtimeEnv.MAIL_INGRESS_QUEUE.send({ type: 'import', syncId })),
    ]);
    return {
      reconciliations: reconciliations.length,
      renewals: renewals.length,
      imports: imports.length,
    };
  } finally {
    await conn.end();
  }
};
