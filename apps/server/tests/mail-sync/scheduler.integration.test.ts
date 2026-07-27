import { describe, expect, it } from 'vitest';

import { createPostgresMailSyncRepository } from '../../src/modules/mail-sync/postgres/sync-repository';
import { insertMailSyncAccountFixture, withMailSyncTestDatabase } from './helpers/database';
import type { IngressScope } from '../../src/modules/mail-sync';

const scope: IngressScope = {
  version: 1,
  mailboxRoles: ['inbox'],
  initialSync: 'none',
};

describe('mail sync scheduler claims', () => {
  it('atomically assigns due work to one scheduler and permits recovery after lease expiry', async () => {
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
        subscriptionExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
      });
      await sql`
        UPDATE integration.inbound_sync
        SET next_reconcile_at = now() - interval '1 minute'
        WHERE id = ${sync.id}
      `;
      await sql`
        INSERT INTO integration.inbound_sync_item (
          id, sync_id, remote_message_id, status, next_attempt_at
        ) VALUES (
          'item-1', ${sync.id}, 'message-1', 'pending', now() - interval '1 minute'
        )
      `;

      const claim = (owner: string) =>
        repository.claimDueDispatches({
          owner,
          limit: 10,
          leaseForMs: 60_000,
          reconcileBefore: new Date('2030-01-01T00:00:00.000Z'),
          renewalBefore: new Date('2030-01-01T00:00:00.000Z'),
          importBefore: new Date('2030-01-01T00:00:00.000Z'),
        });
      const [first, second] = await Promise.all([claim('scheduler-a'), claim('scheduler-b')]);
      const claimed = [...first, ...second];

      expect(claimed).toEqual([
        {
          syncId: sync.id,
          discover: true,
          renew: true,
          importPending: true,
        },
      ]);
      const winner = first.length === 1 ? 'scheduler-a' : 'scheduler-b';
      const loser = winner === 'scheduler-a' ? 'scheduler-b' : 'scheduler-a';
      await expect(claim(loser)).resolves.toEqual([]);

      const [claimedState] = await sql<
        {
          requested_generation: number;
          completed_generation: number;
          dispatch_lease_owner: string | null;
        }[]
      >`
        SELECT requested_generation, completed_generation, dispatch_lease_owner
        FROM integration.inbound_sync
        WHERE id = ${sync.id}
      `;
      expect(claimedState).toEqual({
        requested_generation: 1,
        completed_generation: 0,
        dispatch_lease_owner: winner,
      });

      await sql`
        UPDATE integration.inbound_sync
        SET dispatch_lease_expires_at = now() - interval '1 second'
        WHERE id = ${sync.id}
      `;
      await expect(claim(loser)).resolves.toEqual([
        {
          syncId: sync.id,
          discover: true,
          renew: true,
          importPending: true,
        },
      ]);

      const [reclaimedState] = await sql<
        {
          requested_generation: number;
          completed_generation: number;
          dispatch_lease_owner: string | null;
        }[]
      >`
        SELECT requested_generation, completed_generation, dispatch_lease_owner
        FROM integration.inbound_sync
        WHERE id = ${sync.id}
      `;
      expect(reclaimedState).toEqual({
        requested_generation: 1,
        completed_generation: 0,
        dispatch_lease_owner: loser,
      });
    });
  });
});
