import { index, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { integrationSchema } from '../../../db/pg-schemas';
import { user } from '../../../db/core-schema';

export const externalAccessGrant = integrationSchema.table(
  'external_access_grant',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    codeDigest: text('code_digest').notNull(),
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
