import { boolean, check, integer, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { createMailTable } from '../table';
import { mailAccount } from './accounts';

export const thread = createMailTable(
  'thread',
  {
    id: text('id').primaryKey(),
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    normalizedSubject: text('normalized_subject').notNull(),
    latestReceivedAt: timestamp('latest_received_at', { withTimezone: true }).notNull(),
    emailCount: integer('email_count').notNull().default(0),
    unreadCount: integer('unread_count').notNull().default(0),
    hasAttachment: boolean('has_attachment').notNull().default(false),
    participantSummary: text('participant_summary'),
    preview: text('preview'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('thread_counters_nonnegative_check', sql`${t.emailCount} >= 0 AND ${t.unreadCount} >= 0`),
    check('thread_unread_within_total_check', sql`${t.unreadCount} <= ${t.emailCount}`),
    unique('thread_id_account_uidx').on(t.id, t.mailAccountId),
  ],
);
