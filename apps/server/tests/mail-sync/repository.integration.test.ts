import { describe, expect, it } from 'vitest';

import { createPostgresMailSyncRepository } from '../../src/modules/mail-sync/postgres/sync-repository';
import { insertMailSyncAccountFixture, withMailSyncTestDatabase } from './helpers/database';
import type { IngressScope } from '../../src/modules/mail-sync';

const scope: IngressScope = {
  version: 1,
  mailboxRoles: ['inbox'],
  initialSync: 'none',
};

const createRepository = (
  db: Parameters<Parameters<typeof withMailSyncTestDatabase>[0]>[0]['db'],
) => {
  let id = 0;
  return createPostgresMailSyncRepository(db, {
    newId: () => `generated-${++id}`,
  });
};

describe('PostgreSQL mail sync repository', () => {
  it('creates one activating stream and activates its persisted baseline idempotently', async () => {
    await withMailSyncTestDatabase(async ({ db, sql }) => {
      await insertMailSyncAccountFixture(sql);
      const repository = createRepository(db);

      const first = await repository.createActivatingSync({
        accountId: 'account-1',
        provider: 'gmail',
        scopeKey: 'inbox',
        scope,
      });
      const duplicate = await repository.createActivatingSync({
        accountId: 'account-1',
        provider: 'gmail',
        scopeKey: 'inbox',
        scope,
      });

      expect(duplicate.id).toBe(first.id);
      expect(first).toMatchObject({
        accountId: 'account-1',
        checkpoint: null,
        status: 'activating',
      });

      const baseline = await repository.storeActivationCheckpoint({
        syncId: first.id,
        checkpoint: { version: 1, historyId: '100' },
      });
      expect(baseline).toMatchObject({
        id: first.id,
        checkpoint: { version: 1, historyId: '100' },
        status: 'activating',
      });

      const activated = await repository.activate({
        syncId: first.id,
        subscriptionExpiresAt: new Date('2026-08-01T00:00:00.000Z'),
      });
      expect(activated).toMatchObject({
        id: first.id,
        checkpoint: { version: 1, historyId: '100' },
        status: 'active',
      });

      const repeated = await repository.activate({
        syncId: first.id,
        subscriptionExpiresAt: new Date('2026-08-01T00:00:00.000Z'),
      });
      expect(repeated).toEqual(activated);
    });
  });

  it('grants one stream lease and permits takeover only after database expiry', async () => {
    await withMailSyncTestDatabase(async ({ db, sql }) => {
      await insertMailSyncAccountFixture(sql);
      const repository = createRepository(db);
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

      const leases = await Promise.all([
        repository.acquireSyncLease({
          syncId: sync.id,
          owner: 'worker-a',
          leaseForMs: 60_000,
        }),
        repository.acquireSyncLease({
          syncId: sync.id,
          owner: 'worker-b',
          leaseForMs: 60_000,
        }),
      ]);
      expect(leases.filter((lease) => lease !== null)).toHaveLength(1);
      const winner = leases.find((lease) => lease !== null)!;
      const loser = winner.leaseOwner === 'worker-a' ? 'worker-b' : 'worker-a';

      await expect(
        repository.acquireSyncLease({
          syncId: sync.id,
          owner: loser,
          leaseForMs: 60_000,
        }),
      ).resolves.toBeNull();

      await sql`
        UPDATE integration.inbound_sync
        SET lease_expires_at = now() - interval '1 second'
        WHERE id = ${sync.id}
      `;
      await expect(
        repository.acquireSyncLease({
          syncId: sync.id,
          owner: loser,
          leaseForMs: 60_000,
        }),
      ).resolves.toMatchObject({ leaseOwner: loser });
    });
  });

  it('commits discovered messages and the provider checkpoint together without duplicates', async () => {
    await withMailSyncTestDatabase(async ({ db, sql }) => {
      await insertMailSyncAccountFixture(sql);
      const repository = createRepository(db);
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
      await repository.acquireSyncLease({
        syncId: sync.id,
        owner: 'discovery-worker',
        leaseForMs: 60_000,
      });

      await expect(
        repository.persistDiscoveryPage({
          syncId: sync.id,
          owner: 'wrong-worker',
          events: [],
          checkpoint: { version: 1, historyId: '101' },
        }),
      ).rejects.toThrow('MAIL_SYNC_LEASE_LOST');

      const result = await repository.persistDiscoveryPage({
        syncId: sync.id,
        owner: 'discovery-worker',
        events: [
          {
            type: 'message_added',
            remoteMessageId: 'message-1',
            remoteThreadId: 'thread-1',
          },
          {
            type: 'message_added',
            remoteMessageId: 'message-1',
            remoteThreadId: 'thread-1',
          },
          {
            type: 'message_added',
            remoteMessageId: 'message-2',
            remoteThreadId: null,
          },
        ],
        checkpoint: { version: 1, historyId: '101' },
      });

      expect(result).toEqual({ inserted: 2 });
      const rows = await sql<{ remote_message_id: string; checkpoint: { historyId: string } }[]>`
        SELECT item.remote_message_id, sync.checkpoint
        FROM integration.inbound_sync AS sync
        JOIN integration.inbound_sync_item AS item ON item.sync_id = sync.id
        WHERE sync.id = ${sync.id}
        ORDER BY item.remote_message_id
      `;
      expect(rows).toEqual([
        { remote_message_id: 'message-1', checkpoint: { version: 1, historyId: '101' } },
        { remote_message_id: 'message-2', checkpoint: { version: 1, historyId: '101' } },
      ]);
    });
  });

  it('claims disjoint items, reclaims expired work, and records terminal outcomes', async () => {
    await withMailSyncTestDatabase(async ({ db, sql }) => {
      await insertMailSyncAccountFixture(sql);
      const repository = createRepository(db);
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
      await repository.acquireSyncLease({
        syncId: sync.id,
        owner: 'discovery-worker',
        leaseForMs: 60_000,
      });
      await repository.persistDiscoveryPage({
        syncId: sync.id,
        owner: 'discovery-worker',
        events: ['message-1', 'message-2', 'message-3'].map((remoteMessageId) => ({
          type: 'message_added' as const,
          remoteMessageId,
          remoteThreadId: null,
        })),
        checkpoint: { version: 1, historyId: '101' },
      });

      const [firstClaim, secondClaim] = await Promise.all([
        repository.claimPendingItems({
          syncId: sync.id,
          owner: 'import-worker-a',
          limit: 2,
          leaseForMs: 60_000,
        }),
        repository.claimPendingItems({
          syncId: sync.id,
          owner: 'import-worker-b',
          limit: 2,
          leaseForMs: 60_000,
        }),
      ]);
      const claimed = [...firstClaim, ...secondClaim];
      expect(claimed).toHaveLength(3);
      expect(new Set(claimed.map(({ id }) => id)).size).toBe(3);

      const imported = claimed[0]!;
      await repository.markImported({
        itemId: imported.id,
        owner: imported.leaseOwner!,
        localEmailId: 'local-email-1',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const retry = claimed[1]!;
      await repository.scheduleRetry({
        itemId: retry.id,
        owner: retry.leaseOwner!,
        nextAttemptAt: new Date('2020-01-01T00:00:00.000Z'),
        errorCode: 'RATE_LIMITED',
        errorMessage: 'retry later',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const reclaimed = await repository.claimPendingItems({
        syncId: sync.id,
        owner: 'import-worker-c',
        limit: 1,
        leaseForMs: 60_000,
      });
      expect(reclaimed).toHaveLength(1);
      expect(reclaimed[0]).toMatchObject({ id: retry.id, attemptCount: 2 });
      await repository.markFailed({
        itemId: retry.id,
        owner: 'import-worker-c',
        errorCode: 'BAD_MESSAGE',
        errorMessage: 'permanent failure',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const abandoned = claimed[2]!;
      await sql`
        UPDATE integration.inbound_sync_item
        SET lease_expires_at = now() - interval '1 second'
        WHERE id = ${abandoned.id}
      `;
      const takeover = await repository.claimPendingItems({
        syncId: sync.id,
        owner: 'import-worker-d',
        limit: 1,
        leaseForMs: 60_000,
      });
      expect(takeover[0]).toMatchObject({ id: abandoned.id, attemptCount: 2 });

      const attempts = await sql<{ item_id: string; attempt_number: number; outcome: string }[]>`
        SELECT item_id, attempt_number, outcome
        FROM integration.inbound_sync_attempt
        ORDER BY item_id, attempt_number
      `;
      expect(attempts).toEqual([
        { item_id: imported.id, attempt_number: 1, outcome: 'imported' },
        { item_id: retry.id, attempt_number: 1, outcome: 'retry' },
        { item_id: retry.id, attempt_number: 2, outcome: 'failed' },
      ]);
    });
  });
});
