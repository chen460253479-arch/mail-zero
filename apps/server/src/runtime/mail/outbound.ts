import { type Id, type MailCoreDependencies } from '@zero/mail-core';
import { ulid } from 'ulid';

import {
  createMailOutboundRuntime,
  type MailOutboundCommand,
  type MailOutboundRuntime,
  PostgresMailOutboundUnitOfWork,
} from '../../modules/mail-outbound';
import { PostgresSearchStore } from '../../modules/mail/search/postgres-search-store';
import { createGmailCredentialContext } from './gmail-credential-context';
import { createMailChannelRegistry } from '../../mail-channel/registry';
import { createGmailPlugin } from '../../mail-channel/gmail/plugin';
import { preprocessEmailHtml } from '../../lib/email-processor';
import { R2BlobStore } from '../../modules/mail';
import { createDb, type DB } from '../../db';
import type { ZeroEnv } from '../../env';

const OUTBOUND_LEASE_MS = 5 * 60_000;
const OUTBOUND_SCAN_LIMIT = 100;

export const createMailOutboundRuntimeForEnvironment = (
  db: DB,
  runtimeEnv: ZeroEnv,
): MailOutboundRuntime => {
  const clock = { now: () => new Date() };
  const blobStore = new R2BlobStore(runtimeEnv.THREADS_BUCKET);
  const unitOfWork = new PostgresMailOutboundUnitOfWork(db, {
    nextId: () => ulid(),
    nextLeaseToken: () => crypto.randomUUID(),
  });
  const mailCoreDependencies: MailCoreDependencies = {
    unitOfWork: unitOfWork.mailUnitOfWork,
    searchStore: new PostgresSearchStore(db),
    blobStore,
    blobReadAuditSink: { record: async () => undefined },
    clock,
    idFactory: {
      next<Kind extends string>() {
        return ulid() as Id<Kind>;
      },
    },
    sanitizeHtml: preprocessEmailHtml,
  };
  const contexts = new Map<string, ReturnType<typeof createGmailCredentialContext>>();
  const getContext = (connectionId: string) => {
    const existing = contexts.get(connectionId);
    if (existing !== undefined) return existing;
    const created = createGmailCredentialContext(db, runtimeEnv, connectionId);
    contexts.set(connectionId, created);
    return created;
  };
  const registry = createMailChannelRegistry([
    createGmailPlugin({
      createExecutor: async ({ connectionId }) => {
        if (connectionId === undefined) {
          throw new Error('Gmail outbound requires a connection ID');
        }
        return (await getContext(connectionId)).executor;
      },
      resolveIdentity: async () => {
        throw new Error('Identity resolution is not available in the outbound runtime');
      },
      clock,
    }),
  ]);

  return createMailOutboundRuntime({
    unitOfWork,
    mailCoreDependencies,
    blobStore,
    credentialResolver: {
      resolve: async (connectionId) =>
        await (await getContext(connectionId)).resolveCredential(false),
    },
    registry,
    connectionState: {
      markAuthenticationRequired: async (connectionId) =>
        await (await getContext(connectionId)).markReconnectRequired(),
    },
    wakeup: {
      enqueue: async (command) => await runtimeEnv.MAIL_OUTBOUND_QUEUE.send(command),
    },
    clock,
    nextId: () => ulid(),
    newLeaseOwner: () => crypto.randomUUID(),
    leaseForMs: OUTBOUND_LEASE_MS,
    scanLimit: OUTBOUND_SCAN_LIMIT,
    jitter: Math.random,
    onWakeupError: (error) => console.error('[MAIL_OUTBOUND_QUEUE] wakeup failed', error),
  });
};

export const runMailOutboundCommand = async (
  runtimeEnv: ZeroEnv,
  command: MailOutboundCommand,
): Promise<void> => {
  const { db, conn } = createDb(runtimeEnv.HYPERDRIVE.connectionString);
  try {
    await createMailOutboundRuntimeForEnvironment(db, runtimeEnv).process(command);
  } finally {
    await conn.end();
  }
};

export const enqueueDueMailOutboundWork = async (
  runtimeEnv: ZeroEnv,
): Promise<{ due: number; expired: number; uncertain: number }> => {
  const { db, conn } = createDb(runtimeEnv.HYPERDRIVE.connectionString);
  try {
    return await createMailOutboundRuntimeForEnvironment(db, runtimeEnv).enqueueDue();
  } finally {
    await conn.end();
  }
};
