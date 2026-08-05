import {
  check,
  foreignKey,
  index,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import type { MailChannelId } from '../../../mail-channel/contracts';
import { integrationSchema } from '../../../db/pg-schemas';
import { email } from '../../mail/postgres/schema/emails';
import { user } from '../../../db/core-schema';

export const pendingNangoMailboxBinding = integrationSchema.table(
  'pending_nango_mailbox_binding',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').$type<MailChannelId>().notNull(),
    nangoConnectionId: text('nango_connection_id').notNull(),
    nangoProviderConfigKey: text('nango_provider_config_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pending_nango_mailbox_binding_ref_uidx').on(
      table.nangoProviderConfigKey,
      table.nangoConnectionId,
    ),
    index('pending_nango_mailbox_binding_user_idx').on(table.userId, table.createdAt, table.id),
    check('pending_nango_mailbox_binding_channel_chk', sql`${table.channelId} = 'zoho_mail'`),
  ],
);

export const crmCustomerMarker = integrationSchema.table(
  'crm_customer_marker',
  {
    mailAccountId: text('mail_account_id').notNull(),
    emailId: text('email_id').notNull(),
    customerId: text('customer_id').notNull(),
    customerName: text('customer_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'crm_customer_marker_pk',
      columns: [table.emailId, table.mailAccountId],
    }),
    foreignKey({
      name: 'crm_customer_marker_email_account_fk',
      columns: [table.emailId, table.mailAccountId],
      foreignColumns: [email.id, email.mailAccountId],
    }).onDelete('cascade'),
    index('crm_customer_marker_account_customer_idx').on(
      table.mailAccountId,
      table.customerId,
      table.emailId,
    ),
  ],
);

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
