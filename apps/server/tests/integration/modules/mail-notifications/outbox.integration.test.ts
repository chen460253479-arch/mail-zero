import { describe, expect, it } from 'vitest';

import { createPostgresMailNotificationRepository } from '../../../../src/modules/mail-notifications/postgres/repository';
import { withMailTestDatabase } from '../../../helpers/mail-core/database';

describe('mail notification outbox', () => {
  it('only enqueues Nango mail events owned by managed ordinary users', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await sql`
        INSERT INTO auth.user_account (
          id, name, email, email_verified, username, display_username,
          role, created_at, updated_at
        ) VALUES
          (
            'managed-user-a', 'Managed User A', 'managed-a@example.test', true,
            'external-a', 'external-a', 'user', now(), now()
          ),
          (
            'managed-user-b', 'Managed User B', 'managed-b@example.test', true,
            'external-b', 'external-b', 'user', now(), now()
          ),
          (
            'admin-user', 'Administrator', 'admin@example.test', true,
            'admin', 'admin', 'admin', now(), now()
          ),
          (
            'manual-user', 'Manual User', 'manual@example.test', true,
            'manual-user', 'manual-user', 'user', now(), now()
          ),
          (
            'internal-user', 'Internal User', 'internal@example.test', true,
            NULL, NULL, 'user', now(), now()
          )
      `;
      for (const owner of [
        {
          userId: 'managed-user-a',
          suffix: 'managed-a',
          authSource: 'nango',
        },
        {
          userId: 'managed-user-b',
          suffix: 'managed-b',
          authSource: 'nango',
        },
        {
          userId: 'admin-user',
          suffix: 'admin',
          authSource: 'nango',
        },
        {
          userId: 'manual-user',
          suffix: 'manual',
          authSource: 'manual',
        },
        {
          userId: 'internal-user',
          suffix: 'internal',
          authSource: 'nango',
        },
      ]) {
        await sql`
          INSERT INTO integration.connection (
            id, user_id, email, normalized_email, channel_id,
            status, provider_key, created_at, updated_at
          ) VALUES (
            ${`connection-${owner.suffix}`},
            ${owner.userId},
            ${`${owner.suffix}@example.test`},
            ${`${owner.suffix}@example.test`},
            'gmail',
            'connected',
            'gmail',
            now(),
            now()
          )
        `;
        if (owner.authSource === 'nango') {
          await sql`
            INSERT INTO integration.authorization_binding (
              id, connection_id, auth_source, credential_type,
              nango_connection_id, nango_provider_config_key,
              created_at, updated_at
            ) VALUES (
              ${`authorization-${owner.suffix}`},
              ${`connection-${owner.suffix}`},
              'nango',
              'oauth2',
              ${`connect-${owner.suffix}`},
              'google-mail',
              now(),
              now()
            )
          `;
        } else {
          await sql`
            INSERT INTO integration.authorization_binding (
              id, connection_id, auth_source, credential_type,
              encrypted_credential_snapshot, credential_fetched_at,
              created_at, updated_at
            ) VALUES (
              ${`authorization-${owner.suffix}`},
              ${`connection-${owner.suffix}`},
              'manual',
              'basic',
              'encrypted-test-credential',
              now(),
              now(),
              now()
            )
          `;
        }
        await sql`
          INSERT INTO mail.account (id, connection_id, user_id)
          VALUES (
            ${`account-${owner.suffix}`},
            ${`connection-${owner.suffix}`},
            ${owner.userId}
          )
        `;
        await sql`
          INSERT INTO mail.thread (
            id, mail_account_id, normalized_subject, latest_received_at
          ) VALUES (
            ${`thread-${owner.suffix}`},
            ${`account-${owner.suffix}`},
            'notification',
            now()
          )
        `;
        await sql`
          INSERT INTO mail.email (
            id, mail_account_id, thread_id, normalized_subject,
            received_at, size_bytes, lifecycle
          ) VALUES (
            ${`email-${owner.suffix}`},
            ${`account-${owner.suffix}`},
            ${`thread-${owner.suffix}`},
            'notification',
            now(),
            1,
            'received'
          )
        `;
      }

      const repository = createPostgresMailNotificationRepository(db, {
        enabled: true,
      });
      await repository.enqueue({
        eventId: 'evt-managed-a',
        messageId: 'email-managed-a' as never,
        accountId: 'account-managed-a' as never,
        kind: 'received',
        createdAt: new Date('2026-07-29T10:00:00.000Z'),
      });
      await repository.enqueue({
        eventId: 'evt-managed-b',
        messageId: 'email-managed-b' as never,
        accountId: 'account-managed-b' as never,
        kind: 'received',
        createdAt: new Date('2026-07-29T10:00:00.000Z'),
      });
      await repository.enqueue({
        eventId: 'evt-admin',
        messageId: 'email-admin' as never,
        accountId: 'account-admin' as never,
        kind: 'received',
        createdAt: new Date('2026-07-29T10:00:00.000Z'),
      });
      await repository.enqueue({
        eventId: 'evt-manual',
        messageId: 'email-manual' as never,
        accountId: 'account-manual' as never,
        kind: 'received',
        createdAt: new Date('2026-07-29T10:00:00.000Z'),
      });
      await repository.enqueue({
        eventId: 'evt-internal',
        messageId: 'email-internal' as never,
        accountId: 'account-internal' as never,
        kind: 'received',
        createdAt: new Date('2026-07-29T10:00:00.000Z'),
      });

      const rows = await sql<
        Array<{
          event_id: string;
          message_id: string;
          kind: string;
        }>
      >`
        SELECT event_id, message_id, kind
        FROM mail.notification_outbox
        ORDER BY event_id
      `;
      expect(rows).toEqual([
        {
          event_id: 'evt-managed-a',
          message_id: 'email-managed-a',
          kind: 'received',
        },
        {
          event_id: 'evt-managed-b',
          message_id: 'email-managed-b',
          kind: 'received',
        },
      ]);
    });
  });

  it('does not create an outbox row when webhook delivery is disabled', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      const repository = createPostgresMailNotificationRepository(db, {
        enabled: false,
      });

      await repository.enqueue({
        eventId: 'evt-disabled',
        messageId: 'email-missing' as never,
        accountId: 'account-missing' as never,
        kind: 'received',
        createdAt: new Date('2026-07-29T10:00:00.000Z'),
      });

      const [{ count }] = await sql<Array<{ count: number }>>`
        SELECT count(*)::integer AS count
        FROM mail.notification_outbox
      `;
      expect(count).toBe(0);
    });
  });
});
