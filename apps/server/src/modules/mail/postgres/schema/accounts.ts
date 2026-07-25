import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { connection, user } from '../../../../db/schema';
import { createMailTable } from '../table';

export const mailAccount = createMailTable(
  'mail_account',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status').$type<'active' | 'suspended' | 'deleting'>().notNull().default('active'),
    stateVersion: bigint('state_version', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    oldestRetainedState: bigint('oldest_retained_state', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    timezone: text('timezone').notNull().default('UTC'),
    storageQuotaBytes: bigint('storage_quota_bytes', { mode: 'bigint' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('mail_account_status_check', sql`${t.status} IN ('active', 'suspended', 'deleting')`),
    check(
      'mail_account_state_nonnegative_check',
      sql`${t.stateVersion} >= 0 AND ${t.oldestRetainedState} >= 0`,
    ),
    check('mail_account_retention_floor_check', sql`${t.oldestRetainedState} <= ${t.stateVersion}`),
    check(
      'mail_account_quota_nonnegative_check',
      sql`${t.storageQuotaBytes} IS NULL OR ${t.storageQuotaBytes} >= 0`,
    ),
    uniqueIndex('mail_account_connection_id_uidx').on(t.connectionId),
    index('mail_account_user_id_idx').on(t.userId),
    foreignKey({
      name: 'mail_account_connection_user_fk',
      columns: [t.connectionId, t.userId],
      foreignColumns: [connection.id, connection.userId],
    }).onDelete('cascade'),
  ],
);

export const mailIdentity = createMailTable(
  'mail_identity',
  {
    id: text('id').primaryKey(),
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    name: text('name'),
    email: text('email').notNull(),
    replyTo: text('reply_to'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('mail_identity_id_account_uidx').on(t.id, t.mailAccountId),
    uniqueIndex('mail_identity_account_default_active_uidx')
      .on(t.mailAccountId)
      .where(sql`${t.isDefault} = true AND ${t.deletedAt} IS NULL`),
  ],
);
