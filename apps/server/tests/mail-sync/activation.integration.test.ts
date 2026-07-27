import {
  createMailCore,
  type Id,
  type MailAccountId,
  type MailCoreDependencies,
} from '@zero/mail-core';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createPostgresMailSyncRepository } from '../../src/modules/mail-sync/postgres/sync-repository';
import { bootstrapLocalMailAccount } from '../../src/modules/mail-sync/application/bootstrap-account';
import { PostgresMailUnitOfWork } from '../../src/modules/mail/postgres/postgres-unit-of-work';
import { PostgresSearchStore } from '../../src/modules/mail/search/postgres-search-store';
import { activateInboundSync } from '../../src/modules/mail-sync/application/activate';
import type { InboundMailAdapter } from '../../src/modules/mail-sync';
import { connection, inboundSync, user } from '../../src/db/schema';
import { withMailSyncTestDatabase } from './helpers/database';
import { MemoryBlobStore } from '../../src/modules/mail';

describe('mail sync activation integration', () => {
  it('creates one local account with Inbox and persists the baseline before Watch', async () => {
    await withMailSyncTestDatabase(async ({ db, unitOfWork }) => {
      const now = new Date('2026-01-01T00:00:00.000Z');
      await db.insert(user).values({
        id: 'user-1',
        name: 'User',
        email: 'user@example.com',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(connection).values({
        id: 'connection-1',
        userId: 'user-1',
        email: 'user@example.com',
        normalizedEmail: 'user@example.com',
        channelId: 'gmail',
        providerKey: 'gmail',
        createdAt: now,
        updatedAt: now,
      });

      let nextId = 0;
      const dependencies: MailCoreDependencies = {
        unitOfWork: new PostgresMailUnitOfWork(db),
        searchStore: new PostgresSearchStore(db),
        blobStore: new MemoryBlobStore(),
        blobReadAuditSink: { record: async () => undefined },
        clock: { now: () => new Date(now) },
        idFactory: {
          next<Kind extends string>() {
            nextId += 1;
            return `mail-${nextId}` as Id<Kind>;
          },
        },
        sanitizeHtml: (html) => html,
        cursorSigningKey: 'mail-sync-activation-test-cursor-key',
      };
      const mailCore = createMailCore(dependencies);
      const findByConnectionId = (connectionId: string) =>
        unitOfWork.run((tx) => tx.accounts.findByConnectionId(connectionId));

      const account = await bootstrapLocalMailAccount(
        { userId: 'user-1', connectionId: 'connection-1' },
        {
          findByConnectionId,
          createAccount: (input) => mailCore.createAccount(input),
        },
      );
      const duplicate = await bootstrapLocalMailAccount(
        { userId: 'user-1', connectionId: 'connection-1' },
        {
          findByConnectionId,
          createAccount: (input) => mailCore.createAccount(input),
        },
      );
      expect(duplicate.id).toBe(account.id);

      let checkpointWasPersistedBeforeWatch = false;
      const repository = createPostgresMailSyncRepository(db);
      const adapter: InboundMailAdapter = {
        provider: 'gmail',
        establishCheckpoint: async () => ({
          version: 1,
          historyId: '100',
        }),
        discover: async () => {
          throw new Error('unused');
        },
        fetchRawMessage: async () => {
          throw new Error('unused');
        },
        subscribe: async () => {
          const rows = await db.query.inboundSync.findMany();
          checkpointWasPersistedBeforeWatch =
            rows[0]?.status === 'activating' && rows[0]?.checkpoint !== null;
          return { expiresAt: new Date('2026-08-01T00:00:00.000Z') };
        },
        classifyError: () => 'permanent',
      };
      const activated = await activateInboundSync(
        {
          accountId: account.id as MailAccountId,
          connectionId: 'connection-1',
          provider: 'gmail',
          scopeKey: 'inbox',
          scope: {
            version: 1,
            mailboxRoles: ['inbox'],
            initialSync: 'none',
          },
          subscriptionTarget: {
            version: 1,
            topicName: 'projects/zero/topics/connection-1',
          },
        },
        {
          adapterFactory: { create: async () => adapter },
          repository,
        },
      );

      expect(checkpointWasPersistedBeforeWatch).toBe(true);
      expect(activated.status).toBe('active');
      await expect(
        mailCore.listMailboxes({ accountId: account.id as MailAccountId }),
      ).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ role: 'inbox', name: 'Inbox' })]),
      );

      await db
        .update(inboundSync)
        .set({
          status: 'paused',
          checkpoint: { version: 1, historyId: '100' },
          requestedGeneration: 2,
          completedGeneration: 1,
          pendingCursorHint: '150',
          lastErrorCode: 'GMAIL_HISTORY_GAP',
        })
        .where(eq(inboundSync.id, activated.id));

      const reactivated = await activateInboundSync(
        {
          accountId: account.id as MailAccountId,
          connectionId: 'connection-1',
          provider: 'gmail',
          scopeKey: 'inbox',
          scope: {
            version: 1,
            mailboxRoles: ['inbox'],
            initialSync: 'none',
          },
          subscriptionTarget: {
            version: 1,
            topicName: 'projects/zero/topics/connection-1',
          },
        },
        {
          adapterFactory: {
            create: async () => ({
              ...adapter,
              establishCheckpoint: async () => ({ version: 1, historyId: '200' }),
              subscribe: async ({ checkpoint }) => {
                expect(checkpoint).toEqual({ version: 1, historyId: '200' });
                return { expiresAt: new Date('2026-08-02T00:00:00.000Z') };
              },
            }),
          },
          repository,
        },
      );
      expect(reactivated).toMatchObject({
        status: 'active',
        checkpoint: { version: 1, historyId: '200' },
        requestedGeneration: 2,
        completedGeneration: 2,
        pendingCursorHint: null,
      });
    });
  });
});
