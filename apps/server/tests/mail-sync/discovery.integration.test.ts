import { describe, expect, it } from 'vitest';

import { createPostgresMailSyncRepository } from '../../src/modules/mail-sync/postgres/sync-repository';
import { discoverIncremental } from '../../src/modules/mail-sync/application/discover-incremental';
import { insertMailSyncAccountFixture, withMailSyncTestDatabase } from './helpers/database';
import type { InboundMailAdapter, IngressScope } from '../../src/modules/mail-sync';

const scope: IngressScope = {
  version: 1,
  mailboxRoles: ['inbox'],
  initialSync: 'none',
};

describe('incremental discovery integration', () => {
  it('stores all pages idempotently and advances the checkpoint only with committed data', async () => {
    await withMailSyncTestDatabase(async ({ db, sql }) => {
      await insertMailSyncAccountFixture(sql);
      const repository = createPostgresMailSyncRepository(db);
      const sync = await repository.createActivatingSync({
        accountId: 'account-1',
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

      let call = 0;
      const adapter: InboundMailAdapter = {
        provider: 'gmail',
        establishCheckpoint: async () => {
          throw new Error('unused');
        },
        discover: async () => {
          call += 1;
          return call % 2 === 1
            ? {
                events: [
                  {
                    type: 'message_added',
                    remoteMessageId: 'message-1',
                    remoteThreadId: null,
                  },
                ],
                checkpoint: { version: 1, historyId: '100' },
                nextPageToken: 'next',
              }
            : {
                events: [
                  {
                    type: 'message_added',
                    remoteMessageId: 'message-2',
                    remoteThreadId: null,
                  },
                ],
                checkpoint: { version: 1, historyId: '102' },
                nextPageToken: null,
              };
        },
        fetchRawMessage: async () => {
          throw new Error('unused');
        },
        classifyError: () => 'permanent',
      };
      const dependencies = {
        repository,
        getAdapterFactory: () => ({ create: async () => adapter }),
        resolveConnectionId: async () => 'connection-1',
      };

      await expect(
        discoverIncremental(
          { syncId: sync.id, owner: 'worker-1', leaseForMs: 60_000 },
          dependencies,
        ),
      ).resolves.toEqual({ status: 'completed', inserted: 2 });
      await expect(
        discoverIncremental(
          { syncId: sync.id, owner: 'worker-2', leaseForMs: 60_000 },
          dependencies,
        ),
      ).resolves.toEqual({ status: 'completed', inserted: 0 });

      const [state] = await sql<{ checkpoint: { historyId: string }; item_count: number }[]>`
        SELECT sync.checkpoint, count(item.id)::integer AS item_count
        FROM integration.inbound_sync AS sync
        LEFT JOIN integration.inbound_sync_item AS item ON item.sync_id = sync.id
        WHERE sync.id = ${sync.id}
        GROUP BY sync.id
      `;
      expect(state).toEqual({
        checkpoint: { version: 1, historyId: '102' },
        item_count: 2,
      });
    });
  });
});
