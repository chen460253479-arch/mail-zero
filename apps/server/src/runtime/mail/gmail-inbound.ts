import type { Id, MailAccountId, MailboxId } from '@zero/mail-core';
import { and, eq, isNull } from 'drizzle-orm';
import { ulid } from 'ulid';

import {
  createMailIngressRuntime,
  processMailIngressCommand,
  type MailIngressRuntime,
} from '../../modules/mail-sync/runtime/create-mail-sync';
import {
  authorizationBinding,
  connection,
  inboundSync,
  mailAccount,
  mailbox,
} from '../../db/schema';
import { createPostgresMailSyncRepository } from '../../modules/mail-sync/postgres/sync-repository';
import { bootstrapLocalMailAccount } from '../../modules/mail-sync/application/bootstrap-account';
import { createNangoCredentialRepository } from '../../modules/mail-accounts/credentials/nango';
import { resolveConnectionCredential } from '../../modules/mail-accounts/credentials/resolve';
import { PostgresMailUnitOfWork } from '../../modules/mail/postgres/postgres-unit-of-work';
import { createGoogleGmailApiExecutor } from '../../mail-channel/gmail/shared/google-api';
import type { MailIngressCommand } from '../../modules/mail-sync/application/commands';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';
import type { IngressScope } from '../../modules/mail-sync/domain/ingress-adapter';
import { activateInboundSync } from '../../modules/mail-sync/application/activate';
import { NangoIntegrationService } from '../../integrations/nango/service';
import { createCredentialAwareGmailExecutor } from './gmail-api-executor';
import { defaultMailChannelRegistry } from '../../mail-channel/registry';
import { createMailCoreRuntime, R2BlobStore } from '../../modules/mail';
import { createGmailPlugin } from '../../mail-channel/gmail/plugin';
import { preprocessEmailHtml } from '../../lib/email-processor';
import { NangoClient } from '../../integrations/nango/client';
import { createDb, type DB } from '../../db';
import type { ZeroEnv } from '../../env';

const INBOX_SCOPE: IngressScope = {
  version: 1,
  mailboxRoles: ['inbox'],
  initialSync: 'none',
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

const createAdapterFactory = (db: DB, runtimeEnv: ZeroEnv) => ({
  create: async (connectionId: string) => {
    const record = await findConnection(db, connectionId);
    if (record.connection.channelId !== 'gmail') {
      throw new Error(`Connection channel ${record.connection.channelId} is not Gmail`);
    }
    const nango =
      record.authorization?.authSource === 'nango'
        ? await createNangoResolver(db, runtimeEnv)
        : undefined;
    const resolveCredential = async (forceRefresh: boolean) =>
      await resolveConnectionCredential(
        record,
        runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
        nango ? { nango: { ...nango, forceRefresh } } : {},
      );
    const executor = createCredentialAwareGmailExecutor({
      resolveCredential,
      createClient: createGoogleGmailApiExecutor,
      invalidateCredential: async () => {
        if (nango && record.authorization?.id) {
          await nango.repository.invalidate(record.authorization.id);
        }
      },
      markReconnectRequired: async () => {
        await db
          .update(connection)
          .set({ status: 'reconnect_required', updatedAt: new Date() })
          .where(eq(connection.id, connectionId));
      },
      isUnauthorized: (error) => getAuthErrorCode(error) === '401',
    });
    return await createGmailPlugin({
      createExecutor: async () => executor,
      resolveIdentity: async () => {
        throw new Error('Identity resolution is not available in the inbound runtime');
      },
    }).inbound!.createAdapter({
      connectionId,
      credential: await resolveCredential(false),
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

const topicNameFor = (runtimeEnv: ZeroEnv, connectionId: string): string => {
  const serviceAccount = JSON.parse(runtimeEnv.GOOGLE_S_ACCOUNT) as {
    project_id?: unknown;
  };
  if (typeof serviceAccount.project_id !== 'string' || serviceAccount.project_id.length === 0) {
    throw new Error('Google service account project_id is required');
  }
  return `projects/${serviceAccount.project_id}/topics/notifications__${connectionId}`;
};

export const activateGmailInboundForConnection = async (
  runtimeEnv: ZeroEnv,
  input: { connectionId: string; topicName: string },
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
    await activateInboundSync(
      {
        accountId: account.id,
        connectionId: connectionRecord.id,
        provider: 'gmail',
        scopeKey: 'inbox',
        scope: INBOX_SCOPE,
        subscriptionTarget: {
          version: 1,
          topicName: input.topicName,
        },
      },
      {
        adapterFactory: createAdapterFactory(db, runtimeEnv),
        repository: createPostgresMailSyncRepository(db),
      },
    );
  } finally {
    await conn.end();
  }
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
    resolveSubscriptionTarget: async (syncId) => {
      const context = await resolveImportContext(db, syncId);
      return {
        version: 1,
        topicName: topicNameFor(runtimeEnv, context.connectionId),
      };
    },
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
