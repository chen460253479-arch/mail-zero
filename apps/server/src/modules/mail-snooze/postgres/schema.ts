import { check, foreignKey, index, jsonb, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import type { SnoozeEmailRestore, SnoozeStatus } from '../domain/snooze';
import { mailAccount, thread } from '../../mail/postgres/schema';
import { createMailTable } from '../../mail/postgres/table';

export const threadSnooze = createMailTable(
  'thread_snooze',
  {
    mailAccountId: text('mail_account_id').notNull(),
    threadId: text('thread_id').notNull(),
    wakeAt: timestamp('wake_at', { withTimezone: true }).notNull(),
    restorePlan: jsonb('restore_plan').$type<SnoozeEmailRestore[]>().notNull(),
    status: text('status').$type<SnoozeStatus>().notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'thread_snooze_pk',
      columns: [t.mailAccountId, t.threadId],
    }),
    foreignKey({
      name: 'thread_snooze_account_fk',
      columns: [t.mailAccountId],
      foreignColumns: [mailAccount.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'thread_snooze_thread_account_fk',
      columns: [t.threadId, t.mailAccountId],
      foreignColumns: [thread.id, thread.mailAccountId],
    }).onDelete('cascade'),
    check(
      'thread_snooze_status_chk',
      sql`${t.status} IN ('scheduled', 'waking', 'completed', 'canceled')`,
    ),
    check(
      'thread_snooze_lease_chk',
      sql`(${t.status} = 'waking' AND ${t.leaseOwner} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)
        OR (${t.status} <> 'waking' AND ${t.leaseOwner} IS NULL AND ${t.leaseExpiresAt} IS NULL)`,
    ),
    index('thread_snooze_due_idx')
      .on(t.status, t.wakeAt, t.threadId)
      .where(sql`${t.status} = 'scheduled'`),
    index('thread_snooze_expired_lease_idx')
      .on(t.leaseExpiresAt, t.threadId)
      .where(sql`${t.status} = 'waking'`),
  ],
);
