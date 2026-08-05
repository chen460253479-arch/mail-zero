import { describe, expect, it } from 'vitest';

import {
  insertMailSyncAccountFixture,
  withMailSyncTestDatabase,
} from '../../helpers/mail-sync/database';
import { createPostgresMailSyncRepository } from '../../../src/modules/mail-sync/postgres/sync-repository';
import type { IngressScope } from '../../../src/modules/mail-sync';

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

  it('preserves matching configured streams and removes stale or changed Zoho scopes', async () => {
    await withMailSyncTestDatabase(async ({ db, sql }) => {
      await insertMailSyncAccountFixture(sql);
      const repository = createRepository(db);
      const selectedScope: IngressScope = {
        ...scope,
        externalData: { accountId: '100', folderIds: ['200'] },
      };
      const legacy = await repository.createActivatingSync({
        accountId: 'account-1',
        provider: 'zoho_mail',
        scopeKey: 'inbox',
        scope,
      });
      const selected = await repository.createActivatingSync({
        accountId: 'account-1',
        provider: 'zoho_mail',
        scopeKey: 'folder:200',
        scope: selectedScope,
      });

      await expect(
        repository.reconcileConfiguredScopes({
          accountId: 'account-1',
          provider: 'zoho_mail',
          scopes: [{ scopeKey: 'folder:200', scope: selectedScope }],
        }),
      ).resolves.toBe(1);
      const afterStaleRemoval = await sql<{ id: string }[]>`
        SELECT id
        FROM integration.inbound_sync
        WHERE account_id = 'account-1' AND provider = 'zoho_mail'
      `;
      expect(afterStaleRemoval).toEqual([{ id: selected.id }]);
      expect(afterStaleRemoval).not.toContainEqual({ id: legacy.id });

      await expect(
        repository.reconcileConfiguredScopes({
          accountId: 'account-1',
          provider: 'zoho_mail',
          scopes: [
            {
              scopeKey: 'folder:200',
              scope: {
                ...scope,
                externalData: { accountId: '999', folderIds: ['200'] },
              },
            },
          ],
        }),
      ).resolves.toBe(1);
      const afterScopeChange = await sql<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM integration.inbound_sync
        WHERE account_id = 'account-1' AND provider = 'zoho_mail'
      `;
      expect(afterScopeChange).toEqual([{ count: 0 }]);

      await repository.createActivatingSync({
        accountId: 'account-1',
        provider: 'zoho_mail',
        scopeKey: 'folder:200',
        scope: selectedScope,
      });
      await expect(
        repository.reconcileConfiguredScopes({
          accountId: 'account-1',
          provider: 'zoho_mail',
          scopes: [],
        }),
      ).resolves.toBe(1);
    });
  });

  it('does not lease or dispatch Zoho syncs until CRM supplies account and folders', async () => {
    await withMailSyncTestDatabase(async ({ db, sql }) => {
      await insertMailSyncAccountFixture(sql);
      await sql`
        UPDATE integration.connection
        SET channel_id = 'zoho_mail', provider_key = 'zoho_mail'
        WHERE id = 'connection-1'
      `;
      await sql`
        INSERT INTO integration.authorization_binding (
          id, connection_id, auth_source, credential_type,
          nango_connection_id, nango_provider_config_key, external_data,
          created_at, updated_at
        ) VALUES (
          'authorization-1', 'connection-1', 'nango', 'oauth2',
          'nango-connection-1', 'zoho-mail', '{"accountId":"100"}'::jsonb,
          now(), now()
        )
      `;
      const repository = createRepository(db);
      const sync = await repository.createActivatingSync({
        accountId: 'account-1',
        provider: 'zoho_mail',
        scopeKey: 'folder:200',
        scope: {
          ...scope,
          externalData: { accountId: '100', folderIds: ['200'] },
        },
      });
      await repository.storeActivationCheckpoint({
        syncId: sync.id,
        checkpoint: { version: 2, accountId: '100', folderId: '200', offset: 0 },
      });
      await repository.activate({ syncId: sync.id, subscriptionExpiresAt: null });

      await expect(
        repository.acquireSyncLease({ syncId: sync.id, owner: 'worker', leaseForMs: 60_000 }),
      ).resolves.toBeNull();
      await expect(
        repository.claimDueDispatches({
          owner: 'scheduler',
          limit: 10,
          leaseForMs: 60_000,
          reconcileBefore: new Date('2100-01-01T00:00:00.000Z'),
          renewalBefore: new Date('2100-01-01T00:00:00.000Z'),
          importBefore: new Date('2100-01-01T00:00:00.000Z'),
        }),
      ).resolves.toEqual([]);

      await sql`
        UPDATE integration.authorization_binding
        SET external_data = '{"accountId":"100","folderIds":["200"]}'::jsonb
        WHERE id = 'authorization-1'
      `;
      await expect(
        repository.acquireSyncLease({ syncId: sync.id, owner: 'worker', leaseForMs: 60_000 }),
      ).resolves.toMatchObject({ id: sync.id, leaseOwner: 'worker' });
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

  it('deduplicates discovered pages and advances the provider checkpoint only at completion', async () => {
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
        { remote_message_id: 'message-1', checkpoint: { version: 1, historyId: '100' } },
        { remote_message_id: 'message-2', checkpoint: { version: 1, historyId: '100' } },
      ]);
      await expect(
        repository.completeDiscoveryRun({
          syncId: sync.id,
          owner: 'discovery-worker',
          completedGeneration: 0,
          checkpoint: { version: 1, historyId: '101' },
          reconcileAfterMs: 300_000,
        }),
      ).resolves.toMatchObject({
        requestedGeneration: 0,
        completedGeneration: 0,
        checkpoint: { version: 1, historyId: '101' },
      });
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

  it('moves only the leased active stream into paused or authentication error states', async () => {
    await withMailSyncTestDatabase(async ({ db, sql }) => {
      await insertMailSyncAccountFixture(sql);
      const repository = createRepository(db);

      for (const [scopeKey, transition] of [
        ['inbox-pause', 'pause'] as const,
        ['inbox-auth', 'auth'] as const,
      ]) {
        const sync = await repository.createActivatingSync({
          accountId: 'account-1',
          provider: 'gmail',
          scopeKey,
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
          owner: 'worker-1',
          leaseForMs: 60_000,
        });
        await sql`
          INSERT INTO integration.inbound_sync_item (
            id, sync_id, remote_message_id, status
          ) VALUES (
            ${`item-${transition}`},
            ${sync.id},
            ${`message-${transition}`},
            'pending'
          )
        `;

        await expect(
          transition === 'pause'
            ? repository.pauseSync({
                syncId: sync.id,
                owner: 'wrong-worker',
                errorCode: 'GAP',
                errorMessage: 'gap',
              })
            : repository.markAuthError({
                syncId: sync.id,
                owner: 'wrong-worker',
                errorCode: 'AUTH',
                errorMessage: 'auth',
              }),
        ).rejects.toThrow('MAIL_SYNC_LEASE_LOST');

        if (transition === 'pause') {
          await repository.pauseSync({
            syncId: sync.id,
            owner: 'worker-1',
            errorCode: 'GAP',
            errorMessage: 'gap',
          });
        } else {
          await repository.markAuthError({
            syncId: sync.id,
            owner: 'worker-1',
            errorCode: 'AUTH',
            errorMessage: 'auth',
          });
        }

        await expect(
          repository.claimPendingItems({
            syncId: sync.id,
            owner: 'stale-import-worker',
            limit: 10,
            leaseForMs: 60_000,
          }),
        ).resolves.toEqual([]);
      }

      const states = await sql<{ scope_key: string; status: string; lease_owner: string | null }[]>`
        SELECT scope_key, status, lease_owner
        FROM integration.inbound_sync
        ORDER BY scope_key
      `;
      expect(states).toEqual([
        { scope_key: 'inbox-auth', status: 'auth_error', lease_owner: null },
        { scope_key: 'inbox-pause', status: 'paused', lease_owner: null },
      ]);
    });
  });

  it('coalesces external signals and exposes them through an atomic dispatch claim', async () => {
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
        subscriptionExpiresAt: new Date('2026-08-01T00:00:00.000Z'),
      });

      await expect(
        repository.recordSignal({
          provider: 'gmail',
          externalAccount: 'user@example.com',
          cursorHint: '101',
        }),
      ).resolves.toEqual([sync.id]);
      await repository.recordSignal({
        provider: 'gmail',
        externalAccount: 'user@example.com',
        cursorHint: '99',
      });
      await repository.recordSignal({
        provider: 'gmail',
        externalAccount: 'user@example.com',
        cursorHint: '110',
      });
      await repository.recordSignal({
        provider: 'gmail',
        externalAccount: 'user@example.com',
      });
      await expect(
        repository.claimDueDispatches({
          owner: 'scheduler-1',
          limit: 10,
          leaseForMs: 30_000,
          reconcileBefore: new Date('2030-01-01T00:00:00.000Z'),
          renewalBefore: new Date('2026-08-02T00:00:00.000Z'),
          importBefore: new Date('2030-01-01T00:00:00.000Z'),
        }),
      ).resolves.toEqual([
        {
          syncId: sync.id,
          discover: true,
          renew: true,
          importPending: false,
        },
      ]);

      const lease = await repository.acquireSyncLease({
        syncId: sync.id,
        owner: 'discovery-worker',
        leaseForMs: 60_000,
      });
      expect(lease).not.toBeNull();
      await repository.persistDiscoveryPage({
        syncId: sync.id,
        owner: 'discovery-worker',
        events: [
          {
            type: 'message_added',
            remoteMessageId: 'remote-1',
            remoteThreadId: 'thread-1',
          },
        ],
      });
      await repository.completeDiscoveryRun({
        syncId: sync.id,
        owner: 'discovery-worker',
        completedGeneration: 4,
        checkpoint: { version: 1, historyId: '101' },
        reconcileAfterMs: 300_000,
      });
      await repository.releaseSyncLease({
        syncId: sync.id,
        owner: 'discovery-worker',
      });

      await repository.acquireSyncLease({
        syncId: sync.id,
        owner: 'renew-worker',
        leaseForMs: 60_000,
      });
      await repository.updateSubscription({
        syncId: sync.id,
        owner: 'renew-worker',
        subscriptionExpiresAt: new Date('2026-08-10T00:00:00.000Z'),
        subscriptionWarning: null,
      });

      const [state] = await sql<
        {
          last_signal_at: Date | null;
          requested_generation: number;
          completed_generation: number;
          pending_cursor_hint: string | null;
          subscription_expires_at: Date | null;
        }[]
      >`
        SELECT
          last_signal_at,
          requested_generation,
          completed_generation,
          pending_cursor_hint,
          subscription_expires_at
        FROM integration.inbound_sync
        WHERE id = ${sync.id}
      `;
      expect(state?.last_signal_at).not.toBeNull();
      expect(state).toMatchObject({
        requested_generation: 4,
        completed_generation: 4,
        pending_cursor_hint: null,
      });
      expect(new Date(String(state?.subscription_expires_at))).toEqual(
        new Date('2026-08-10T00:00:00.000Z'),
      );
    });
  });

  it('pauses every sync owned by one connection and clears active leases', async () => {
    await withMailSyncTestDatabase(async ({ db, sql }) => {
      await insertMailSyncAccountFixture(sql);
      await sql`
        INSERT INTO auth.user_account (
          id, name, email, email_verified, role, created_at, updated_at
        ) VALUES (
          'user-2', 'Other User', 'other@example.com', true, 'admin', now(), now()
        )
      `;
      await sql`
        INSERT INTO integration.connection (
          id, user_id, email, normalized_email, channel_id, status,
          provider_key, created_at, updated_at
        ) VALUES (
          'connection-2', 'user-2', 'other@example.com', 'other@example.com',
          'gmail', 'connected', 'gmail', now(), now()
        )
      `;
      await sql`
        INSERT INTO mail.account (id, connection_id, user_id)
        VALUES ('account-2', 'connection-2', 'user-2')
      `;
      const repository = createRepository(db);
      const createActiveSync = async (accountId: string) => {
        const sync = await repository.createActivatingSync({
          accountId,
          provider: 'gmail',
          scopeKey: 'inbox',
          scope,
        });
        await repository.storeActivationCheckpoint({
          syncId: sync.id,
          checkpoint: { version: 1, historyId: '100' },
        });
        await repository.activate({ syncId: sync.id, subscriptionExpiresAt: null });
        await repository.acquireSyncLease({
          syncId: sync.id,
          owner: `worker-${accountId}`,
          leaseForMs: 60_000,
        });
        return sync;
      };
      const ownedSync = await createActiveSync('account-1');
      const otherSync = await createActiveSync('account-2');

      await expect(
        repository.pauseConnectionSyncs({
          userId: 'user-1',
          connectionId: 'connection-1',
          errorCode: 'MAILBOX_DISCONNECTED',
          errorMessage: 'Mailbox authorization was disconnected',
        }),
      ).resolves.toBe(1);

      const states = await sql<
        {
          id: string;
          status: string;
          lease_owner: string | null;
          lease_expires_at: Date | null;
        }[]
      >`
        SELECT id, status, lease_owner, lease_expires_at
        FROM integration.inbound_sync
        ORDER BY id
      `;
      expect(states).toEqual(
        expect.arrayContaining([
          {
            id: ownedSync.id,
            status: 'paused',
            lease_owner: null,
            lease_expires_at: null,
          },
          expect.objectContaining({
            id: otherSync.id,
            status: 'active',
            lease_owner: 'worker-account-2',
          }),
        ]),
      );

      await expect(repository.prepareActivation({ syncId: ownedSync.id })).resolves.toMatchObject({
        id: ownedSync.id,
        status: 'activating',
        checkpoint: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      });
    });
  });
});
