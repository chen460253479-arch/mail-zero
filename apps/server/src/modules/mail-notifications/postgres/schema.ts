import { boolean, check, foreignKey, index, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { mailAccount } from '../../mail/postgres/schema/accounts';
import { email } from '../../mail/postgres/schema/emails';
import { mailSchema } from '../../../db/pg-schemas';

export const mailNotificationOutbox = mailSchema.table(
  'notification_outbox',
  {
    eventId: text('event_id').primaryKey(),
    eventType: text('event_type')
      .$type<'message' | 'submission_status'>()
      .notNull()
      .default('message'),
    messageId: text('message_id'),
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'received' | 'sent' | 'failed'>().notNull(),
    externalSubmissionId: text('external_submission_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createCustomerIfMissing: boolean('create_customer_if_missing').notNull().default(false),
    status: text('status')
      .$type<'ready' | 'running' | 'retry' | 'dead'>()
      .notNull()
      .default('ready'),
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(10),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', {
      withTimezone: true,
    }),
    lastErrorMessage: text('last_error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'mail_notification_event_type_chk',
      sql`${table.eventType} IN ('message', 'submission_status')`,
    ),
    check('mail_notification_kind_chk', sql`${table.kind} IN ('received', 'sent', 'failed')`),
    check(
      'mail_notification_payload_chk',
      sql`(
        ${table.eventType} = 'message'
        AND ${table.messageId} IS NOT NULL
        AND ${table.kind} IN ('received', 'sent')
        AND ${table.externalSubmissionId} IS NULL
        AND ${table.sentAt} IS NULL
        AND ${table.errorCode} IS NULL
        AND ${table.errorMessage} IS NULL
      ) OR (
        ${table.eventType} = 'submission_status'
        AND ${table.externalSubmissionId} IS NOT NULL
        AND ((
            ${table.kind} = 'sent'
            AND ${table.messageId} IS NOT NULL
            AND ${table.sentAt} IS NOT NULL
            AND ${table.errorCode} IS NULL
            AND ${table.errorMessage} IS NULL
          ) OR (
            ${table.kind} = 'failed'
            AND ${table.sentAt} IS NULL
            AND ${table.errorCode} IS NOT NULL
          ))
      )`,
    ),
    check(
      'mail_notification_status_chk',
      sql`${table.status} IN ('ready', 'running', 'retry', 'dead')`,
    ),
    check(
      'mail_notification_attempts_chk',
      sql`${table.attempts} >= 0 AND ${table.maxAttempts} = 10`,
    ),
    check(
      'mail_notification_lease_chk',
      sql`(
        ${table.status} = 'running'
        AND ${table.leaseOwner} IS NOT NULL
        AND ${table.leaseExpiresAt} IS NOT NULL
      ) OR (
        ${table.status} <> 'running'
        AND ${table.leaseOwner} IS NULL
        AND ${table.leaseExpiresAt} IS NULL
      )`,
    ),
    index('mail_notification_due_idx')
      .on(table.status, table.runAt, table.eventId)
      .where(sql`${table.status} IN ('ready', 'retry')`),
    index('mail_notification_lease_idx')
      .on(table.leaseExpiresAt, table.eventId)
      .where(sql`${table.status} = 'running'`),
    index('mail_notification_dead_idx')
      .on(table.completedAt, table.eventId)
      .where(sql`${table.status} = 'dead'`),
    index('mail_notification_message_idx').on(table.mailAccountId, table.messageId),
    index('mail_notification_external_submission_idx').on(table.externalSubmissionId),
    foreignKey({
      name: 'mail_notification_email_account_fk',
      columns: [table.messageId, table.mailAccountId],
      foreignColumns: [email.id, email.mailAccountId],
    }).onDelete('cascade'),
  ],
);
