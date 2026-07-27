import { createMailCore } from '@zero/mail-core';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createPostgresMailSyncRepository } from '../../src/modules/mail-sync/postgres/sync-repository';
import { importPendingMessages } from '../../src/modules/mail-sync/application/import-pending';
import type { InboundMailAdapter, IngressScope } from '../../src/modules/mail-sync';
import { createPostgresMailTestHarness } from '../mail-core/helpers/harness';
import { withMailSyncTestDatabase } from './helpers/database';
import { inboundSync } from '../../src/db/schema';

const scope: IngressScope = {
  version: 1,
  mailboxRoles: ['inbox'],
  initialSync: 'none',
};

describe('pending import integration', () => {
  it('imports raw MIME into local Email, Thread, Inbox membership, and change log', async () => {
    await withMailSyncTestDatabase(async ({ db, sql, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'mail-sync-import');
      const repository = createPostgresMailSyncRepository(db);
      const sync = await repository.createActivatingSync({
        accountId: harness.accountId,
        provider: 'gmail',
        scopeKey: 'inbox',
        scope,
      });
      await repository.storeActivationCheckpoint({
        syncId: sync.id,
        checkpoint: { version: 1, historyId: '100' },
      });
      await repository.activate({
        syncId: sync.id,
        subscriptionExpiresAt: null,
      });
      await repository.acquireSyncLease({
        syncId: sync.id,
        owner: 'discovery-worker',
        leaseForMs: 60_000,
      });
      await repository.persistDiscoveryPage({
        syncId: sync.id,
        owner: 'discovery-worker',
        events: [
          {
            type: 'message_added',
            remoteMessageId: 'gmail-message-1',
            remoteThreadId: 'gmail-thread-ignored-for-local-threading',
          },
        ],
      });
      await repository.releaseSyncLease({
        syncId: sync.id,
        owner: 'discovery-worker',
      });

      const raw = new TextEncoder().encode(
        [
          'From: sender@example.test',
          'To: recipient@example.test',
          'Message-ID: <gmail-message-1@example.test>',
          'Date: Thu, 1 Jan 2026 10:00:00 +0000',
          'Subject: Local inbox import',
          'Content-Type: text/plain; charset=utf-8',
          '',
          'body stored by the local mail core',
        ].join('\r\n'),
      );
      const adapter: InboundMailAdapter = {
        provider: 'gmail',
        establishCheckpoint: async () => {
          throw new Error('unused');
        },
        discover: async () => {
          throw new Error('unused');
        },
        fetchRawMessage: async ({ remoteMessageId }) => ({
          remoteMessageId,
          raw,
          receivedAt: new Date('2026-01-01T10:00:00.000Z'),
        }),
        classifyError: () => 'permanent',
      };

      const result = await importPendingMessages(
        {
          syncId: sync.id,
          owner: 'import-worker',
          limit: 10,
          leaseForMs: 60_000,
          maxAttempts: 5,
          baseRetryDelayMs: 1_000,
        },
        {
          clock: harness.dependencies.clock,
          resolveContext: async () => ({
            accountId: harness.accountId,
            connectionId: 'postgres-connection-mail-sync-import',
            provider: 'gmail',
            scope,
            inboxMailboxId: harness.inbox.id,
          }),
          getAdapterFactory: () => ({ create: async () => adapter }),
          repository,
          mailCore: createMailCore(harness.dependencies),
          onAuthenticationError: async () => undefined,
        },
      );

      expect(result).toEqual({
        claimed: 1,
        imported: 1,
        retried: 0,
        failed: 0,
      });
      const [projection] = await sql<
        {
          email_count: number;
          thread_count: number;
          inbox_memberships: number;
          change_count: number;
          local_email_id: string | null;
        }[]
      >`
        SELECT
          (SELECT count(*)::integer FROM mail.email
            WHERE mail_account_id = ${harness.accountId}) AS email_count,
          (SELECT count(*)::integer FROM mail.thread
            WHERE mail_account_id = ${harness.accountId}) AS thread_count,
          (SELECT count(*)::integer FROM mail.email_mailbox
            WHERE mail_account_id = ${harness.accountId}
              AND mailbox_id = ${harness.inbox.id}) AS inbox_memberships,
          (SELECT count(*)::integer FROM mail.change
            WHERE mail_account_id = ${harness.accountId}) AS change_count,
          (SELECT local_email_id FROM integration.inbound_sync_item
            WHERE sync_id = ${sync.id}) AS local_email_id
      `;
      expect(projection).toMatchObject({
        email_count: 1,
        thread_count: 1,
        inbox_memberships: 1,
      });
      expect(projection!.change_count).toBeGreaterThan(0);
      expect(projection!.local_email_id).toBeTruthy();

      await repository.acquireSyncLease({
        syncId: sync.id,
        owner: 'second-discovery-worker',
        leaseForMs: 60_000,
      });
      await repository.persistDiscoveryPage({
        syncId: sync.id,
        owner: 'second-discovery-worker',
        events: [
          {
            type: 'message_added',
            remoteMessageId: 'gmail-message-2',
            remoteThreadId: null,
          },
        ],
      });
      await repository.releaseSyncLease({
        syncId: sync.id,
        owner: 'second-discovery-worker',
      });

      const authenticationResult = await importPendingMessages(
        {
          syncId: sync.id,
          owner: 'authentication-worker',
          limit: 10,
          leaseForMs: 60_000,
          maxAttempts: 5,
          baseRetryDelayMs: 1_000,
        },
        {
          clock: harness.dependencies.clock,
          resolveContext: async () => ({
            accountId: harness.accountId,
            connectionId: 'postgres-connection-mail-sync-import',
            provider: 'gmail',
            scope,
            inboxMailboxId: harness.inbox.id,
          }),
          getAdapterFactory: () => ({
            create: async () => ({
              ...adapter,
              fetchRawMessage: async () => {
                throw new Error('unauthorized');
              },
              classifyError: () => 'authentication',
            }),
          }),
          repository,
          mailCore: createMailCore(harness.dependencies),
          onAuthenticationError: async ({ syncId, errorCode, errorMessage }) => {
            await db
              .update(inboundSync)
              .set({
                status: 'auth_error',
                lastErrorCode: errorCode,
                lastErrorMessage: errorMessage,
              })
              .where(eq(inboundSync.id, syncId));
          },
        },
      );
      expect(authenticationResult).toEqual({
        claimed: 1,
        imported: 0,
        retried: 1,
        failed: 0,
      });

      await repository.prepareActivation({ syncId: sync.id });
      await repository.storeActivationCheckpoint({
        syncId: sync.id,
        checkpoint: { version: 1, historyId: '200' },
      });
      await repository.activate({
        syncId: sync.id,
        subscriptionExpiresAt: null,
      });

      const recoveredResult = await importPendingMessages(
        {
          syncId: sync.id,
          owner: 'recovered-worker',
          limit: 10,
          leaseForMs: 60_000,
          maxAttempts: 5,
          baseRetryDelayMs: 1_000,
        },
        {
          clock: harness.dependencies.clock,
          resolveContext: async () => ({
            accountId: harness.accountId,
            connectionId: 'postgres-connection-mail-sync-import',
            provider: 'gmail',
            scope,
            inboxMailboxId: harness.inbox.id,
          }),
          getAdapterFactory: () => ({
            create: async () => ({
              ...adapter,
              fetchRawMessage: async ({ remoteMessageId }) => ({
                remoteMessageId,
                raw: new TextEncoder().encode(
                  new TextDecoder().decode(raw).replaceAll('gmail-message-1', remoteMessageId),
                ),
                receivedAt: new Date('2026-01-01T10:05:00.000Z'),
              }),
            }),
          }),
          repository,
          mailCore: createMailCore(harness.dependencies),
          onAuthenticationError: async () => {
            throw new Error('must not fail authentication after reauthorization');
          },
        },
      );
      expect(recoveredResult).toEqual({
        claimed: 1,
        imported: 1,
        retried: 0,
        failed: 0,
      });

      const [recoveredItem] = await sql<
        {
          status: string;
          attempt_count: number;
          attempt_rows: number;
        }[]
      >`
        SELECT
          item.status,
          item.attempt_count,
          count(attempt.id)::integer AS attempt_rows
        FROM integration.inbound_sync_item item
        LEFT JOIN integration.inbound_sync_attempt attempt ON attempt.item_id = item.id
        WHERE item.sync_id = ${sync.id}
          AND item.remote_message_id = 'gmail-message-2'
        GROUP BY item.id
      `;
      expect(recoveredItem).toEqual({
        status: 'imported',
        attempt_count: 2,
        attempt_rows: 2,
      });
    });
  });
});
