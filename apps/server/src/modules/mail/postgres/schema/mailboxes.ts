import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { createMailTable } from '../table';
import { mailAccount } from './accounts';

export const mailbox = createMailTable(
  'mailbox',
  {
    id: text('id').primaryKey(),
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    kind: text('kind').$type<'system' | 'folder' | 'label'>().notNull(),
    role: text('role').$type<
      'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'outbox' | 'scheduled'
    >(),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    isSubscribed: boolean('is_subscribed').notNull().default(true),
    totalEmails: integer('total_emails').notNull().default(0),
    unreadEmails: integer('unread_emails').notNull().default(0),
    totalThreads: integer('total_threads').notNull().default(0),
    unreadThreads: integer('unread_threads').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('mailbox_kind_check', sql`${t.kind} IN ('system', 'folder', 'label')`),
    check(
      'mailbox_role_check',
      sql`${t.role} IS NULL OR ${t.role} IN ('inbox', 'sent', 'drafts', 'trash', 'junk', 'archive', 'outbox', 'scheduled')`,
    ),
    check(
      'mailbox_counters_nonnegative_check',
      sql`${t.totalEmails} >= 0
          AND ${t.unreadEmails} >= 0
          AND ${t.totalThreads} >= 0
          AND ${t.unreadThreads} >= 0
          AND ${t.unreadEmails} <= ${t.totalEmails}
          AND ${t.unreadThreads} <= ${t.totalThreads}`,
    ),
    unique('mailbox_id_account_uidx').on(t.id, t.mailAccountId),
    foreignKey({
      name: 'mailbox_parent_account_fk',
      columns: [t.parentId, t.mailAccountId],
      foreignColumns: [t.id, t.mailAccountId],
    }).onDelete('cascade'),
    uniqueIndex('mailbox_account_role_active_uidx')
      .on(t.mailAccountId, t.role)
      .where(sql`${t.role} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    uniqueIndex('mailbox_active_sibling_name_uidx')
      .on(t.mailAccountId, t.parentId, t.normalizedName)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('mailbox_active_root_name_uidx')
      .on(t.mailAccountId, t.normalizedName)
      .where(sql`${t.parentId} IS NULL AND ${t.deletedAt} IS NULL`),
    index('mailbox_account_sort_active_idx')
      .on(t.mailAccountId, t.sortOrder, t.id)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);
