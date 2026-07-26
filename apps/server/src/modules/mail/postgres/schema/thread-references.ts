import { foreignKey, index, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { createMailTable } from '../table';
import { mailAccount } from './accounts';
import { thread } from './threads';
import { email } from './emails';

export const threadReference = createMailTable(
  'thread_reference',
  {
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    normalizedSubjectHash: text('normalized_subject_hash').notNull(),
    messageIdHash: text('message_id_hash').notNull(),
    emailId: text('email_id').notNull(),
    threadId: text('thread_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'thread_reference_pk',
      columns: [t.mailAccountId, t.normalizedSubjectHash, t.messageIdHash, t.emailId],
    }),
    foreignKey({
      name: 'thread_reference_email_account_fk',
      columns: [t.emailId, t.mailAccountId],
      foreignColumns: [email.id, email.mailAccountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'thread_reference_thread_account_fk',
      columns: [t.threadId, t.mailAccountId],
      foreignColumns: [thread.id, thread.mailAccountId],
    }).onDelete('cascade'),
    index('thread_reference_account_subject_message_idx').on(
      t.mailAccountId,
      t.normalizedSubjectHash,
      t.messageIdHash,
    ),
    index('thread_reference_account_thread_idx').on(t.mailAccountId, t.threadId),
    index('thread_reference_account_email_idx').on(t.mailAccountId, t.emailId),
  ],
);
