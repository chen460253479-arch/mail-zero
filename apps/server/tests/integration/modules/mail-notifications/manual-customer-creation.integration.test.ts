import { describe, expect, it } from 'vitest';

import { createPostgresManualCustomerCreationRepository } from '../../../../src/modules/mail-notifications/postgres/manual-customer-creation-repository';
import { withMailTestDatabase } from '../../../helpers/mail-core/database';

describe('manual customer creation repository', () => {
  it('accepts an unmarked received email without restricting the account authorization type', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await sql`
        INSERT INTO auth.user_account (
          id, name, email, email_verified, username, display_username,
          role, created_at, updated_at
        ) VALUES
          ('managed-user', 'Managed', 'managed@example.test', true,
           'managed', 'managed', 'user', now(), now()),
          ('manual-user', 'Manual', 'manual@example.test', true,
           'manual', 'manual', 'user', now(), now())
      `;
      await sql`
        INSERT INTO integration.connection (
          id, user_id, email, normalized_email, channel_id,
          status, provider_key, created_at, updated_at
        ) VALUES
          ('connection-managed', 'managed-user', 'managed@example.test',
           'managed@example.test', 'gmail', 'connected', 'gmail', now(), now()),
          ('connection-manual', 'manual-user', 'manual@example.test',
           'manual@example.test', 'gmail', 'connected', 'gmail', now(), now())
      `;
      await sql`
        INSERT INTO integration.authorization_binding (
          id, connection_id, auth_source, credential_type,
          nango_connection_id, nango_provider_config_key,
          created_at, updated_at
        ) VALUES (
          'authorization-managed', 'connection-managed', 'nango', 'oauth2',
          'nango-managed', 'google-mail', now(), now()
        )
      `;
      await sql`
        INSERT INTO integration.authorization_binding (
          id, connection_id, auth_source, credential_type,
          encrypted_credential_snapshot, credential_fetched_at,
          created_at, updated_at
        ) VALUES (
          'authorization-manual', 'connection-manual', 'manual', 'basic',
          'encrypted-test-credential', now(), now(), now()
        )
      `;
      await sql`
        INSERT INTO mail.account (id, connection_id, user_id) VALUES
          ('account-managed', 'connection-managed', 'managed-user'),
          ('account-manual', 'connection-manual', 'manual-user')
      `;
      await sql`
        INSERT INTO mail.thread (
          id, mail_account_id, normalized_subject, latest_received_at
        ) VALUES
          ('thread-ready', 'account-managed', 'ready', now()),
          ('thread-sent', 'account-managed', 'sent', now()),
          ('thread-destroyed', 'account-managed', 'destroyed', now()),
          ('thread-marked', 'account-managed', 'marked', now()),
          ('thread-manual', 'account-manual', 'manual', now())
      `;
      await sql`
        INSERT INTO mail.email (
          id, mail_account_id, thread_id, normalized_subject,
          received_at, size_bytes, lifecycle, destroyed_at
        ) VALUES
          ('email-ready', 'account-managed', 'thread-ready', 'ready', now(), 1, 'received', NULL),
          ('email-sent', 'account-managed', 'thread-sent', 'sent', now(), 1, 'sent', NULL),
          ('email-destroyed', 'account-managed', 'thread-destroyed', 'destroyed', now(), 1, 'received', now()),
          ('email-marked', 'account-managed', 'thread-marked', 'marked', now(), 1, 'received', NULL),
          ('email-manual', 'account-manual', 'thread-manual', 'manual', now(), 1, 'received', NULL)
      `;
      await sql`
        INSERT INTO integration.crm_customer_marker (
          mail_account_id, email_id, customer_id, customer_name
        ) VALUES ('account-managed', 'email-marked', 'customer-1', 'Existing Customer')
      `;

      const repository = createPostgresManualCustomerCreationRepository(db);

      await expect(
        repository.inspect({ accountId: 'account-managed', messageId: 'email-ready' }),
      ).resolves.toBe('ready');
      await expect(
        repository.inspect({ accountId: 'account-managed', messageId: 'email-sent' }),
      ).resolves.toBe('not-received');
      await expect(
        repository.inspect({ accountId: 'account-managed', messageId: 'email-destroyed' }),
      ).resolves.toBe('not-found');
      await expect(
        repository.inspect({ accountId: 'account-managed', messageId: 'email-marked' }),
      ).resolves.toBe('already-marked');
      await expect(
        repository.inspect({ accountId: 'account-managed', messageId: 'email-manual' }),
      ).resolves.toBe('not-found');
      await expect(
        repository.inspect({ accountId: 'account-manual', messageId: 'email-manual' }),
      ).resolves.toBe('ready');

      await expect(
        repository.enqueue({
          eventId: 'event-ready',
          accountId: 'account-managed',
          messageId: 'email-ready',
          kind: 'received',
          createCustomerIfMissing: true,
          createdAt: new Date('2026-08-12T02:00:00.000Z'),
        }),
      ).resolves.toBe(true);
      await expect(
        repository.enqueue({
          eventId: 'event-manual',
          accountId: 'account-manual',
          messageId: 'email-manual',
          kind: 'received',
          createCustomerIfMissing: true,
          createdAt: new Date('2026-08-12T02:00:00.000Z'),
        }),
      ).resolves.toBe(true);

      const rows = await sql<
        Array<{ event_id: string; message_id: string; create_customer_if_missing: boolean }>
      >`
        SELECT event_id, message_id, create_customer_if_missing
        FROM mail.notification_outbox
        ORDER BY event_id
      `;
      expect(rows).toEqual([
        {
          event_id: 'event-manual',
          message_id: 'email-manual',
          create_customer_if_missing: true,
        },
        {
          event_id: 'event-ready',
          message_id: 'email-ready',
          create_customer_if_missing: true,
        },
      ]);
    });
  });
});
