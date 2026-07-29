import { index, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import type { GrantedMailboxScope } from '../contracts/access';
import { connection, user } from '../../../db/core-schema';
import { integrationSchema } from '../../../db/pg-schemas';

export const externalAccessGrant = integrationSchema.table(
  'external_access_grant',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    codeDigest: text('code_digest').notNull(),
    scopes: jsonb('scopes').$type<GrantedMailboxScope[]>().notNull(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
    }).notNull(),
    consumedAt: timestamp('consumed_at', {
      withTimezone: true,
    }),
  },
  (table) => [
    uniqueIndex('external_access_grant_code_digest_uidx').on(table.codeDigest),
    index('external_access_grant_expires_idx').on(table.expiresAt, table.id),
  ],
);

export const externalBrowserSession = integrationSchema.table(
  'external_browser_session',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tokenDigest: text('token_digest').notNull(),
    scopes: jsonb('scopes').$type<GrantedMailboxScope[]>().notNull(),
    activeConnectionId: text('active_connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).notNull(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    uniqueIndex('external_browser_session_token_digest_uidx').on(table.tokenDigest),
    index('external_browser_session_expires_idx').on(table.expiresAt, table.id),
    index('external_browser_session_owner_idx').on(table.ownerUserId, table.updatedAt),
  ],
);
