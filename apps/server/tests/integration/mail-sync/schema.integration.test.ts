import { describe, expect, it } from 'vitest';

import {
  insertMailSyncAccountFixture,
  withMailSyncTestDatabase,
} from '../../helpers/mail-sync/database';

describe('mail sync database schema', () => {
  it('creates the durable inbound synchronization tables and work indexes', async () => {
    await withMailSyncTestDatabase(async ({ sql }) => {
      const tables = await sql<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'integration'
          AND table_name LIKE 'inbound_sync%'
        ORDER BY table_name
      `;
      expect(tables.map(({ table_name }) => table_name)).toEqual([
        'inbound_sync',
        'inbound_sync_attempt',
        'inbound_sync_item',
      ]);

      const syncColumns = await sql<{ column_name: string }[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'integration'
          AND table_name = 'inbound_sync'
      `;
      expect(syncColumns.map(({ column_name }) => column_name)).toEqual(
        expect.arrayContaining([
          'last_error_code',
          'last_error_message',
          'requested_generation',
          'completed_generation',
          'pending_cursor_hint',
          'next_reconcile_at',
          'dispatch_lease_owner',
          'dispatch_lease_expires_at',
          'subscription_external_id',
          'subscription_endpoint_token_hash',
          'encrypted_subscription_secret',
          'subscription_established_at',
        ]),
      );

      const indexes = await sql<{ indexname: string }[]>`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'integration'
          AND tablename IN ('inbound_sync', 'inbound_sync_item')
      `;
      expect(indexes.map(({ indexname }) => indexname)).toEqual(
        expect.arrayContaining([
          'inbound_sync_due_reconcile_idx',
          'inbound_sync_due_renewal_idx',
          'inbound_sync_lease_idx',
          'inbound_sync_due_dispatch_idx',
          'inbound_sync_dispatch_lease_idx',
          'inbound_sync_subscription_external_idx',
          'inbound_sync_subscription_endpoint_token_idx',
          'inbound_sync_item_pending_idx',
          'inbound_sync_item_due_pending_idx',
          'inbound_sync_item_lease_idx',
        ]),
      );
    });
  });

  it('enforces account ownership, provider state versions, and stream uniqueness', async () => {
    await withMailSyncTestDatabase(async ({ sql }) => {
      await insertMailSyncAccountFixture(sql);

      await sql`
        INSERT INTO integration.inbound_sync (
          id, account_id, provider, scope_key, scope, checkpoint, status
        ) VALUES (
          'sync-1',
          'account-1',
          'gmail',
          'inbox',
          '{"version":1,"mailboxRoles":["inbox"],"initialSync":"none"}'::jsonb,
          '{"version":1,"historyId":"100"}'::jsonb,
          'active'
        )
      `;

      await expect(
        sql`
          INSERT INTO integration.inbound_sync (
            id, account_id, provider, scope_key, scope, checkpoint, status
          ) VALUES (
            'sync-duplicate',
            'account-1',
            'gmail',
            'inbox',
            '{"version":1,"mailboxRoles":["inbox"],"initialSync":"none"}'::jsonb,
            '{"version":1,"historyId":"101"}'::jsonb,
            'active'
          )
        `,
      ).rejects.toThrow(/inbound_sync_account_provider_scope_uidx/u);

      await expect(
        sql`
          INSERT INTO integration.inbound_sync (
            id, account_id, provider, scope_key, scope, checkpoint, status
          ) VALUES (
            'sync-orphan',
            'missing-account',
            'gmail',
            'inbox',
            '{"version":1,"mailboxRoles":["inbox"],"initialSync":"none"}'::jsonb,
            '{"version":1,"historyId":"100"}'::jsonb,
            'active'
          )
        `,
      ).rejects.toThrow(/inbound_sync_account_fk/u);

      await expect(
        sql`
          INSERT INTO integration.inbound_sync (
            id, account_id, provider, scope_key, scope, checkpoint, status
          ) VALUES (
            'sync-invalid-state',
            'account-1',
            'gmail',
            'other',
            '{"mailboxRoles":["inbox"],"initialSync":"none"}'::jsonb,
            '{"version":1,"historyId":"100"}'::jsonb,
            'active'
          )
        `,
      ).rejects.toThrow(/inbound_sync_scope_version_chk/u);

      await expect(
        sql`
          INSERT INTO integration.inbound_sync (
            id, account_id, provider, scope_key, scope, checkpoint, status
          ) VALUES (
            'sync-invalid-provider',
            'account-1',
            'gamil',
            'other',
            '{"version":1,"mailboxRoles":["inbox"],"initialSync":"none"}'::jsonb,
            '{"version":1,"historyId":"100"}'::jsonb,
            'active'
          )
        `,
      ).rejects.toThrow(/inbound_sync_provider_chk/u);

      await expect(
        sql`
          UPDATE integration.inbound_sync
          SET requested_generation = -1
          WHERE id = 'sync-1'
        `,
      ).rejects.toThrow(/inbound_sync_generation_nonnegative_chk/u);

      await expect(
        sql`
          UPDATE integration.inbound_sync
          SET requested_generation = 1, completed_generation = 2
          WHERE id = 'sync-1'
        `,
      ).rejects.toThrow(/inbound_sync_generation_order_chk/u);

      await expect(
        sql`
          UPDATE integration.inbound_sync
          SET dispatch_lease_owner = 'scheduler-1', dispatch_lease_expires_at = NULL
          WHERE id = 'sync-1'
        `,
      ).rejects.toThrow(/inbound_sync_dispatch_lease_pair_chk/u);
    });
  });

  it('deduplicates remote messages and rejects invalid imported item state', async () => {
    await withMailSyncTestDatabase(async ({ sql }) => {
      await insertMailSyncAccountFixture(sql);
      await sql`
        INSERT INTO integration.inbound_sync (
          id, account_id, provider, scope_key, scope, checkpoint, status
        ) VALUES (
          'sync-1',
          'account-1',
          'gmail',
          'inbox',
          '{"version":1,"mailboxRoles":["inbox"],"initialSync":"none"}'::jsonb,
          '{"version":1,"historyId":"100"}'::jsonb,
          'active'
        )
      `;
      await sql`
        INSERT INTO integration.inbound_sync_item (
          id, sync_id, remote_message_id, status
        ) VALUES ('item-1', 'sync-1', 'message-1', 'pending')
      `;

      await expect(
        sql`
          INSERT INTO integration.inbound_sync_item (
            id, sync_id, remote_message_id, status
          ) VALUES ('item-2', 'sync-1', 'message-1', 'pending')
        `,
      ).rejects.toThrow(/inbound_sync_item_remote_message_uidx/u);

      await expect(
        sql`
          INSERT INTO integration.inbound_sync_item (
            id, sync_id, remote_message_id, status
          ) VALUES ('item-3', 'sync-1', 'message-3', 'imported')
        `,
      ).rejects.toThrow(/inbound_sync_item_imported_state_chk/u);

      await expect(
        sql`
          INSERT INTO integration.inbound_sync_item (
            id, sync_id, remote_message_id, status
          ) VALUES ('item-4', 'sync-1', 'message-4', 'processing')
        `,
      ).rejects.toThrow(/inbound_sync_item_processing_lease_chk/u);

      await expect(
        sql`
          INSERT INTO integration.inbound_sync_item (
            id, sync_id, remote_message_id, status, lease_owner, lease_expires_at
          ) VALUES (
            'item-5', 'sync-1', 'message-5', 'pending',
            'worker-1', now() + interval '1 minute'
          )
        `,
      ).rejects.toThrow(/inbound_sync_item_processing_lease_chk/u);
    });
  });

  it('allows one Zoho webhook endpoint to wake multiple selected folder streams', async () => {
    await withMailSyncTestDatabase(async ({ sql }) => {
      await insertMailSyncAccountFixture(sql);

      await sql`
        INSERT INTO integration.inbound_sync (
          id, account_id, provider, scope_key, scope, checkpoint, status,
          subscription_endpoint_token_hash
        ) VALUES
        (
          'sync-folder-200',
          'account-1',
          'zoho_mail',
          'folder:200',
          '{"version":1,"mailboxRoles":["inbox"],"initialSync":"none","externalData":{"accountId":"100","folderIds":["200"]}}'::jsonb,
          '{"version":2,"accountId":"100","folderId":"200"}'::jsonb,
          'active',
          'shared-endpoint-hash'
        ),
        (
          'sync-folder-300',
          'account-1',
          'zoho_mail',
          'folder:300',
          '{"version":1,"mailboxRoles":["inbox"],"initialSync":"none","externalData":{"accountId":"100","folderIds":["300"]}}'::jsonb,
          '{"version":2,"accountId":"100","folderId":"300"}'::jsonb,
          'active',
          'shared-endpoint-hash'
        )
      `;

      const streams = await sql<{ id: string }[]>`
        SELECT id
        FROM integration.inbound_sync
        WHERE subscription_endpoint_token_hash = 'shared-endpoint-hash'
        ORDER BY id
      `;
      expect(streams.map(({ id }) => id)).toEqual(['sync-folder-200', 'sync-folder-300']);
    });
  });
});
