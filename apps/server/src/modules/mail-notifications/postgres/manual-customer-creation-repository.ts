import { and, eq, isNull, sql } from 'drizzle-orm';

import type {
  CustomerCreationInspection,
  ManualCustomerCreationRepository,
} from '../application/request-customer-creation';
import { crmCustomerMarker } from '../../external-integration/postgres/schema';
import { email as mailEmail } from '../../mail/postgres/schema/emails';
import { mailNotificationOutbox } from './schema';
import type { DB } from '../../../db';

export const createPostgresManualCustomerCreationRepository = (
  db: DB,
): ManualCustomerCreationRepository => ({
  inspect: async (input): Promise<CustomerCreationInspection> => {
    const [candidate] = await db
      .select({ lifecycle: mailEmail.lifecycle, threadId: mailEmail.threadId })
      .from(mailEmail)
      .where(
        and(
          eq(mailEmail.id, input.messageId),
          eq(mailEmail.mailAccountId, input.accountId),
          isNull(mailEmail.destroyedAt),
        ),
      )
      .limit(1);
    if (candidate === undefined) return 'not-found';
    if (candidate.lifecycle !== 'received') return 'not-received';

    const [marker] = await db
      .select({ emailId: crmCustomerMarker.emailId })
      .from(crmCustomerMarker)
      .innerJoin(
        mailEmail,
        and(
          eq(mailEmail.id, crmCustomerMarker.emailId),
          eq(mailEmail.mailAccountId, crmCustomerMarker.mailAccountId),
        ),
      )
      .where(
        and(
          eq(crmCustomerMarker.mailAccountId, input.accountId),
          eq(mailEmail.threadId, candidate.threadId),
          isNull(mailEmail.destroyedAt),
        ),
      )
      .limit(1);
    return marker === undefined ? 'ready' : 'already-marked';
  },

  enqueue: async (input) => {
    const rows = await db.execute(sql`
      INSERT INTO mail.notification_outbox (
        event_id,
        message_id,
        mail_account_id,
        kind,
        create_customer_if_missing,
        status,
        run_at,
        attempts,
        max_attempts,
        created_at,
        updated_at
      )
      SELECT
        ${input.eventId},
        candidate.id,
        candidate.mail_account_id,
        'received',
        true,
        'ready',
        ${sql.param(input.createdAt, mailNotificationOutbox.runAt)},
        0,
        10,
        ${sql.param(input.createdAt, mailNotificationOutbox.createdAt)},
        ${sql.param(input.createdAt, mailNotificationOutbox.updatedAt)}
      FROM mail.email AS candidate
      WHERE candidate.id = ${input.messageId}
        AND candidate.mail_account_id = ${input.accountId}
        AND candidate.destroyed_at IS NULL
        AND candidate.lifecycle = 'received'
        AND NOT EXISTS (
          SELECT 1
          FROM integration.crm_customer_marker AS marker
          INNER JOIN mail.email AS marked_email
            ON marked_email.id = marker.email_id
            AND marked_email.mail_account_id = marker.mail_account_id
          WHERE marker.mail_account_id = candidate.mail_account_id
            AND marked_email.thread_id = candidate.thread_id
            AND marked_email.destroyed_at IS NULL
        )
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id
    `);
    return rows.length === 1;
  },
});
