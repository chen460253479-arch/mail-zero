import {
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { createMailTable } from '../table';
import { mailAccount, mailIdentity } from './accounts';
import { email } from './emails';

export const emailSubmission = createMailTable(
  'email_submission',
  {
    id: text('id').primaryKey(),
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    emailId: text('email_id').notNull(),
    identityId: text('identity_id').notNull(),
    status: text('status')
      .$type<'scheduled' | 'queued' | 'sending' | 'retry_wait' | 'sent' | 'failed' | 'canceled'>()
      .notNull(),
    sendAt: timestamp('send_at', { withTimezone: true }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    providerMessageId: text('provider_message_id'),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    unique('email_submission_id_account_uidx').on(t.id, t.mailAccountId),
    foreignKey({
      name: 'email_submission_email_account_fk',
      columns: [t.emailId, t.mailAccountId],
      foreignColumns: [email.id, email.mailAccountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'email_submission_identity_account_fk',
      columns: [t.identityId, t.mailAccountId],
      foreignColumns: [mailIdentity.id, mailIdentity.mailAccountId],
    }).onDelete('restrict'),
    index('email_submission_account_status_send_idx').on(t.mailAccountId, t.status, t.sendAt),
    uniqueIndex('email_submission_account_idempotency_uidx').on(
      t.mailAccountId,
      t.idempotencyKey,
    ),
  ],
);

export const submissionAttempt = createMailTable(
  'submission_attempt',
  {
    id: text('id').primaryKey(),
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    submissionId: text('submission_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    outcome: text('outcome').$type<'sent' | 'transient_failure' | 'permanent_failure'>(),
    providerCode: text('provider_code'),
    safeResponse: text('safe_response'),
    retryAt: timestamp('retry_at', { withTimezone: true }),
  },
  (t) => [
    unique('submission_attempt_id_account_uidx').on(t.id, t.mailAccountId),
    unique('submission_attempt_account_submission_number_uidx').on(
      t.mailAccountId,
      t.submissionId,
      t.attemptNumber,
    ),
    foreignKey({
      name: 'submission_attempt_submission_account_fk',
      columns: [t.submissionId, t.mailAccountId],
      foreignColumns: [emailSubmission.id, emailSubmission.mailAccountId],
    }).onDelete('cascade'),
  ],
);
