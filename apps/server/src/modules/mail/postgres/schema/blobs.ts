import { bigint, check, index, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { createMailTable } from '../table';
import { mailAccount } from './accounts';

export const blob = createMailTable(
  'blob',
  {
    id: text('id').primaryKey(),
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    sha256: text('sha256').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    contentType: text('content_type').notNull(),
    objectKey: text('object_key').notNull(),
    status: text('status').$type<'pending' | 'ready' | 'deleting'>().notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('blob_status_check', sql`${t.status} IN ('pending', 'ready', 'deleting')`),
    check('blob_size_nonnegative_check', sql`${t.sizeBytes} >= 0`),
    check(
      'blob_lifecycle_check',
      sql`(${t.status} = 'pending' AND ${t.readyAt} IS NULL AND ${t.deletedAt} IS NULL)
          OR (${t.status} = 'ready' AND ${t.readyAt} IS NOT NULL AND ${t.deletedAt} IS NULL)
          OR (${t.status} = 'deleting' AND ${t.readyAt} IS NOT NULL)`,
    ),
    unique('blob_id_account_uidx').on(t.id, t.mailAccountId),
    index('blob_account_sha_size_idx').on(t.mailAccountId, t.sha256, t.sizeBytes),
  ],
);
