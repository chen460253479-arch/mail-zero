import { check, foreignKey, index, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { mailAccount } from '../../mail/postgres/schema/accounts';
import { email } from '../../mail/postgres/schema/emails';
import { mailSchema } from '../../../db/pg-schemas';

export const mailNotificationOutbox = mailSchema.table(
  'notification_outbox',
  {
    eventId: text('event_id').primaryKey(),
    messageId: text('message_id').notNull(),
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'received' | 'sent'>().notNull(),
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
    check('mail_notification_kind_chk', sql`${table.kind} IN ('received', 'sent')`),
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
    foreignKey({
      name: 'mail_notification_email_account_fk',
      columns: [table.messageId, table.mailAccountId],
      foreignColumns: [email.id, email.mailAccountId],
    }).onDelete('cascade'),
  ],
);
