import { createMailCore, type EmailId } from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { createPostgresMailSyncRepository } from '../../../src/modules/mail-sync/postgres/sync-repository';
import { discoverIncremental } from '../../../src/modules/mail-sync/application/discover-incremental';
import { importPendingMessages } from '../../../src/modules/mail-sync/application/import-pending';
import { activateInboundSync } from '../../../src/modules/mail-sync/application/activate';
import type { InboundMailAdapter, IngressScope } from '../../../src/modules/mail-sync';
import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailSyncTestDatabase } from '../../helpers/mail-sync/database';

const scope: IngressScope = {
  version: 1,
  mailboxRoles: ['inbox'],
  initialSync: 'none',
};

describe('Gmail incremental Inbox end-to-end', () => {
  it('binds at the current cursor, imports only later Inbox mail, and keeps local changes local', async () => {
    await withMailSyncTestDatabase(async ({ db, sql, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'gmail-e2e');
      const repository = createPostgresMailSyncRepository(db);
      const mailCore = createMailCore(harness.dependencies);
      const calls = {
        createAdapter: 0,
        establishCheckpoint: 0,
        subscribe: 0,
        discover: 0,
        fetchRawMessage: 0,
      };
      const raw = new TextEncoder().encode(
        [
          'From: sender@example.test',
          'To: gmail-e2e@example.test',
          'Message-ID: <gmail-new-message@example.test>',
          'Date: Thu, 1 Jan 2026 10:00:00 +0000',
          'Subject: New after activation',
          'Content-Type: text/plain; charset=utf-8',
          '',
          'incremental body',
        ].join('\r\n'),
      );
      const adapter: InboundMailAdapter = {
        provider: 'gmail',
        establishCheckpoint: async () => {
          calls.establishCheckpoint += 1;
          return { version: 1, historyId: '100' };
        },
        subscribe: async ({ checkpoint }) => {
          calls.subscribe += 1;
          expect(checkpoint).toEqual({ version: 1, historyId: '100' });
          return { expiresAt: new Date('2026-08-01T00:00:00.000Z') };
        },
        discover: async ({ checkpoint }) => {
          calls.discover += 1;
          if (
            'historyId' in checkpoint &&
            typeof checkpoint.historyId === 'string' &&
            checkpoint.historyId === '100'
          ) {
            return {
              events: [
                {
                  type: 'message_added',
                  remoteMessageId: 'gmail-new-message',
                  remoteThreadId: 'gmail-thread-1',
                },
              ],
              checkpoint: { version: 1, historyId: '101' },
              nextPageToken: null,
            };
          }
          return {
            events: [],
            checkpoint,
            nextPageToken: null,
          };
        },
        fetchRawMessage: async ({ remoteMessageId }) => {
          calls.fetchRawMessage += 1;
          return {
            remoteMessageId,
            raw,
            receivedAt: new Date('2026-01-01T10:00:00.000Z'),
          };
        },
        classifyError: () => 'permanent',
      };
      const adapterFactory = {
        create: async () => {
          calls.createAdapter += 1;
          return adapter;
        },
      };
      const connectionId = 'postgres-connection-gmail-e2e';

      const activated = await activateInboundSync(
        {
          accountId: harness.accountId,
          connectionId,
          provider: 'gmail',
          scopeKey: 'inbox',
          scope,
          subscriptionTarget: {
            version: 1,
            topicName: 'projects/zero/topics/gmail-e2e',
          },
        },
        { adapterFactory, repository },
      );
      await activateInboundSync(
        {
          accountId: harness.accountId,
          connectionId,
          provider: 'gmail',
          scopeKey: 'inbox',
          scope,
          subscriptionTarget: {
            version: 1,
            topicName: 'projects/zero/topics/gmail-e2e',
          },
        },
        { adapterFactory, repository },
      );
      expect(calls.establishCheckpoint).toBe(1);
      expect(calls.subscribe).toBe(1);

      await expect(
        discoverIncremental(
          { syncId: activated.id, owner: 'discover-1', leaseForMs: 60_000 },
          {
            repository,
            getAdapterFactory: () => adapterFactory,
            resolveConnectionId: async () => connectionId,
          },
        ),
      ).resolves.toEqual({ status: 'completed', inserted: 1 });

      await expect(
        importPendingMessages(
          {
            syncId: activated.id,
            owner: 'import-1',
            limit: 10,
            leaseForMs: 60_000,
            maxAttempts: 5,
            baseRetryDelayMs: 1_000,
          },
          {
            clock: harness.dependencies.clock,
            resolveContext: async () => ({
              accountId: harness.accountId,
              connectionId,
              provider: 'gmail',
              scope,
              inboxMailboxId: harness.inbox.id,
            }),
            getAdapterFactory: () => adapterFactory,
            repository,
            mailCore,
            onAuthenticationError: async () => undefined,
          },
        ),
      ).resolves.toMatchObject({ claimed: 1, imported: 1 });

      await expect(
        discoverIncremental(
          { syncId: activated.id, owner: 'discover-2', leaseForMs: 60_000 },
          {
            repository,
            getAdapterFactory: () => adapterFactory,
            resolveConnectionId: async () => connectionId,
          },
        ),
      ).resolves.toEqual({ status: 'completed', inserted: 0 });

      const [projection] = await sql<
        {
          email_count: number;
          item_count: number;
          local_email_id: string;
          checkpoint: { version: number; historyId: string };
        }[]
      >`
        SELECT
          (SELECT count(*)::integer FROM mail.email
            WHERE mail_account_id = ${harness.accountId}) AS email_count,
          count(item.id)::integer AS item_count,
          max(item.local_email_id) AS local_email_id,
          sync.checkpoint
        FROM integration.inbound_sync AS sync
        LEFT JOIN integration.inbound_sync_item AS item ON item.sync_id = sync.id
        WHERE sync.id = ${activated.id}
        GROUP BY sync.id
      `;
      expect(projection).toMatchObject({
        email_count: 1,
        item_count: 1,
        checkpoint: { version: 1, historyId: '101' },
      });

      const providerCallsBeforeLocalChange = { ...calls };
      await mailCore.updateEmail({
        accountId: harness.accountId,
        emailId: projection!.local_email_id as EmailId,
        addKeywords: ['$seen'],
      });
      expect(calls).toEqual(providerCallsBeforeLocalChange);

      const localKeywords = await sql<{ keyword: string }[]>`
        SELECT keyword
        FROM mail.email_keyword
        WHERE email_id = ${projection!.local_email_id}
      `;
      expect(localKeywords.map(({ keyword }) => keyword)).toContain('$seen');
      expect(calls.fetchRawMessage).toBe(1);
    });
  });
});
