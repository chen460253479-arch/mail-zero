import {
  check,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import type { ExternalMailSubmissionPayload } from '../contracts/mail-submission';
import { mailAccount, mailIdentity } from '../../mail/postgres/schema/accounts';
import { emailSubmission } from '../../mail/postgres/schema/submissions';
import { connection, user } from '../../../db/core-schema';
import { integrationSchema } from '../../../db/pg-schemas';
import { email } from '../../mail/postgres/schema/emails';

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

export type ExternalMailSubmissionStoredStatus = 'accepted' | 'preparing' | 'submitted' | 'failed';

export const externalMailSubmission = integrationSchema.table(
  'external_mail_submission',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mailAccountId: text('mail_account_id').notNull(),
    internalConnectionId: text('internal_connection_id').notNull(),
    identityId: text('identity_id').notNull(),
    externalUserId: text('external_user_id').notNull(),
    externalConnectionId: text('external_connection_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    payload: jsonb('payload').$type<ExternalMailSubmissionPayload>().notNull(),
    status: text('status').$type<ExternalMailSubmissionStoredStatus>().notNull(),
    emailId: text('email_id'),
    submissionId: text('submission_id'),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'external_mail_submission_status_chk',
      sql`${table.status} IN ('accepted', 'preparing', 'submitted', 'failed')`,
    ),
    check(
      'external_mail_submission_fingerprint_chk',
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'external_mail_submission_link_chk',
      sql`(${table.status} = 'submitted' AND ${table.emailId} IS NOT NULL AND ${table.submissionId} IS NOT NULL) OR ${table.status} <> 'submitted'`,
    ),
    foreignKey({
      name: 'external_mail_submission_connection_user_fk',
      columns: [table.internalConnectionId, table.userId],
      foreignColumns: [connection.id, connection.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'external_mail_submission_account_connection_fk',
      columns: [table.mailAccountId, table.internalConnectionId],
      foreignColumns: [mailAccount.id, mailAccount.connectionId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'external_mail_submission_identity_account_fk',
      columns: [table.identityId, table.mailAccountId],
      foreignColumns: [mailIdentity.id, mailIdentity.mailAccountId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'external_mail_submission_email_account_fk',
      columns: [table.emailId, table.mailAccountId],
      foreignColumns: [email.id, email.mailAccountId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'external_mail_submission_submission_account_fk',
      columns: [table.submissionId, table.mailAccountId],
      foreignColumns: [emailSubmission.id, emailSubmission.mailAccountId],
    }).onDelete('restrict'),
    uniqueIndex('external_mail_submission_idempotency_uidx').on(
      table.userId,
      table.externalConnectionId,
      table.idempotencyKey,
    ),
    index('external_mail_submission_account_created_idx').on(
      table.mailAccountId,
      table.createdAt,
      table.id,
    ),
    index('external_mail_submission_status_updated_idx').on(
      table.status,
      table.updatedAt,
      table.id,
    ),
  ],
);
