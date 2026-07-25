import { bigint, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';

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
    unique('blob_id_account_uidx').on(t.id, t.mailAccountId),
    uniqueIndex('blob_account_sha_size_uidx').on(t.mailAccountId, t.sha256, t.sizeBytes),
  ],
);
