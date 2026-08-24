import { sql } from 'drizzle-orm';

import type { MailDatabase } from '../../mail/postgres/repositories/database';
import { mailNotificationOutbox } from './schema';

export type MailSubmissionTerminalStatus = 'sent' | 'failed';

export interface MailSubmissionStatusNotificationRepository {
  enqueueForMailSubmission(input: {
    eventId: string;
    accountId: string;
    mailSubmissionId: string;
    status: MailSubmissionTerminalStatus;
    occurredAt: Date;
  }): Promise<boolean>;
}

export const createPostgresMailSubmissionStatusNotificationRepository = (
  db: MailDatabase,
  options: { enabled: boolean },
): MailSubmissionStatusNotificationRepository => ({
  enqueueForMailSubmission: async (input) => {
    if (!options.enabled) return false;
    const rows = await db.execute(sql`
      INSERT INTO mail.notification_outbox (
        event_id,
        event_type,
        message_id,
        mail_account_id,
        kind,
        external_submission_id,
        sent_at,
        error_code,
        error_message,
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
        'submission_status',
        submission.email_id,
        external_submission.mail_account_id,
        ${input.status},
        external_submission.id,
        CASE WHEN ${input.status} = 'sent' THEN submission.sent_at ELSE NULL END,
        CASE
          WHEN ${input.status} = 'failed'
          THEN COALESCE(submission.last_error_code, 'MAIL_SEND_FAILED')
          ELSE NULL
        END,
        CASE WHEN ${input.status} = 'failed' THEN submission.last_error_message ELSE NULL END,
        false,
        'ready',
        ${sql.param(input.occurredAt, mailNotificationOutbox.runAt)},
        0,
        10,
        ${sql.param(input.occurredAt, mailNotificationOutbox.createdAt)},
        ${sql.param(input.occurredAt, mailNotificationOutbox.updatedAt)}
      FROM mail.submission AS submission
      INNER JOIN integration.external_mail_submission AS external_submission
        ON external_submission.mail_account_id = submission.mail_account_id
        AND submission.idempotency_key = 'external-mail:' || external_submission.id
      WHERE submission.id = ${input.mailSubmissionId}
        AND submission.mail_account_id = ${input.accountId}
        AND submission.status = ${input.status}
      ON CONFLICT DO NOTHING
      RETURNING event_id
    `);
    return rows.length === 1;
  },
});
