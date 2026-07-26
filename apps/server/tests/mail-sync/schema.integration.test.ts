import { describe, expect, it } from 'vitest';

import { insertMailSyncAccountFixture, withMailSyncTestDatabase } from './helpers/database';

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
        expect.arrayContaining(['last_error_code', 'last_error_message']),
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
          'inbound_sync_item_pending_idx',
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
    });
  });
});
