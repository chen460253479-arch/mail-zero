import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
  ensureExternalIntegrationPrincipal,
} from '../../../../src/modules/external-integration/principal';
import { createPostgresMailNotificationRepository } from '../../../../src/modules/mail-notifications/postgres/repository';
import { withMailTestDatabase } from '../../../helpers/mail-core/database';

describe('mail notification outbox', () => {
  it('enqueues only mail owned by the integration principal', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await ensureExternalIntegrationPrincipal(db);
      await sql`
        INSERT INTO auth.user_account (
          id, name, email, email_verified, role, created_at, updated_at
        ) VALUES (
          'normal-user', 'Normal User', 'normal@example.test', true, 'user', now(), now()
        )
      `;
      for (const owner of [
        {
          userId: EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
          suffix: 'external',
        },
        {
          userId: 'normal-user',
          suffix: 'normal',
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
        eventId: 'evt-external',
        messageId: 'email-external' as never,
        accountId: 'account-external' as never,
        kind: 'received',
        createdAt: new Date('2026-07-29T10:00:00.000Z'),
      });
      await repository.enqueue({
        eventId: 'evt-normal',
        messageId: 'email-normal' as never,
        accountId: 'account-normal' as never,
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
          event_id: 'evt-external',
          message_id: 'email-external',
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
