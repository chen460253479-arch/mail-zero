import { check, foreignKey, index, integer, primaryKey, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { createMailTable } from '../table';
import { mailAccount } from './accounts';
import { mailbox } from './mailboxes';
import { thread } from './threads';

export const mailboxThread = createMailTable(
  'mailbox_thread',
  {
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    mailboxId: text('mailbox_id').notNull(),
    threadId: text('thread_id').notNull(),
    emailCount: integer('email_count').notNull(),
    unreadCount: integer('unread_count').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'mailbox_thread_pk',
      columns: [t.mailAccountId, t.mailboxId, t.threadId],
    }),
    foreignKey({
      name: 'mailbox_thread_mailbox_account_fk',
      columns: [t.mailboxId, t.mailAccountId],
      foreignColumns: [mailbox.id, mailbox.mailAccountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'mailbox_thread_thread_account_fk',
      columns: [t.threadId, t.mailAccountId],
      foreignColumns: [thread.id, thread.mailAccountId],
    }).onDelete('cascade'),
    check(
      'mailbox_thread_counters_positive_check',
      sql`${t.emailCount} > 0 AND ${t.unreadCount} >= 0`,
    ),
    check('mailbox_thread_unread_within_total_check', sql`${t.unreadCount} <= ${t.emailCount}`),
    index('mailbox_thread_account_thread_idx').on(t.mailAccountId, t.threadId),
  ],
);
