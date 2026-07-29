import type { Id, MailAccountId, MailCoreDependencies } from '@zero/mail-core';
import { createMailAccount } from '@zero/mail-core';
import type { DB } from '../../../src/db';

import { MemoryBlobStore } from '../../../../../packages/mail-core/src/testing/memory-blob-store';
import { PostgresMailUnitOfWork } from '../../../src/modules/mail/postgres/postgres-unit-of-work';
import { PostgresSearchStore } from '../../../src/modules/mail/search/postgres-search-store';
import { connection, user } from '../../../src/db/schema';

export const createPostgresMailTestHarness = async (
  db: DB,
  unitOfWork: PostgresMailUnitOfWork,
  suffix = 'primary',
) => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const userId = `postgres-user-${suffix}`;
  const connectionId = `postgres-connection-${suffix}`;
  await db.insert(user).values({
    id: userId,
    name: `Postgres User ${suffix}`,
    email: `${suffix}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(connection).values({
    id: connectionId,
    userId,
    email: `${suffix}@example.test`,
    normalizedEmail: `${suffix}@example.test`,
    channelId: 'gmail',
    providerKey: 'test.postgres',
    createdAt: now,
    updatedAt: now,
  });
  const blobStore = new MemoryBlobStore();
  let nextId = 1;
  const dependencies: MailCoreDependencies = {
    unitOfWork,
    blobStore,
    blobReadAuditSink: { record: async () => undefined },
    searchStore: new PostgresSearchStore(db),
    clock: { now: () => new Date(now) },
    idFactory: {
      next<Kind extends string>() {
        const value = `${suffix}-${nextId.toString().padStart(8, '0')}`;
        nextId += 1;
        return value as Id<Kind>;
      },
    },
    sanitizeHtml: (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ''),
    cursorSigningKey: 'postgres-mail-test-cursor-key',
  };
  const account = await createMailAccount(dependencies, {
    userId,
    connectionId,
    timezone: 'UTC',
    storageQuotaBytes: null,
  });
  const mailboxByRole = async (role: string) =>
    unitOfWork.run(async (tx) =>
      (await tx.mailboxes.listByAccount(account.id)).find((mailbox) => mailbox.role === role),
    );
  return {
    db,
    unitOfWork,
    dependencies,
    blobStore,
    accountId: account.id as MailAccountId,
    inbox: (await mailboxByRole('inbox'))!,
    drafts: (await mailboxByRole('drafts'))!,
  };
};
