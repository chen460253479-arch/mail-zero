import { bigint, check, index, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { createMailTable } from '../table';
import { mailAccount } from './accounts';

export const mailChange = createMailTable(
  'mail_change',
  {
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    stateVersion: bigint('state_version', { mode: 'bigint' }).notNull(),
    collection: text('collection')
      .$type<'mailbox' | 'email' | 'thread' | 'identity' | 'email_submission'>()
      .notNull(),
    entityId: text('entity_id').notNull(),
    changeType: text('change_type').$type<'created' | 'updated' | 'destroyed'>().notNull(),
    changedProperties: text('changed_properties').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'mail_change_collection_check',
      sql`${t.collection} IN ('mailbox', 'email', 'thread', 'identity', 'email_submission')`,
    ),
    check('mail_change_type_check', sql`${t.changeType} IN ('created', 'updated', 'destroyed')`),
    check('mail_change_state_positive_check', sql`${t.stateVersion} > 0`),
    primaryKey({
      name: 'mail_change_pk',
      columns: [t.mailAccountId, t.stateVersion, t.collection, t.entityId],
    }),
    index('mail_change_account_state_collection_entity_idx').on(
      t.mailAccountId,
      t.stateVersion,
      t.collection,
      t.entityId,
    ),
  ],
);
