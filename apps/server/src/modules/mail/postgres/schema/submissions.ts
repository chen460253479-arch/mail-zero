import {
  bigint,
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

import { mailAccount, mailIdentity } from './accounts';
import { createMailTable } from '../table';
import { email } from './emails';
import { blob } from './blobs';

export const emailSubmission = createMailTable(
  'submission',
  {
    id: text('id').primaryKey(),
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    emailId: text('email_id').notNull(),
    identityId: text('identity_id').notNull(),
    status: text('status')
      .$type<'scheduled' | 'queued' | 'sent' | 'failed' | 'canceled'>()
      .notNull(),
    sendAt: timestamp('send_at', { withTimezone: true }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    draftRevision: integer('draft_revision').notNull(),
    providerMessageId: text('provider_message_id'),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'email_submission_status_check',
      sql`${t.status} IN ('scheduled', 'queued', 'sent', 'failed', 'canceled')`,
    ),
    check('email_submission_draft_revision_nonnegative_check', sql`${t.draftRevision} >= 0`),
    unique('email_submission_id_account_uidx').on(t.id, t.mailAccountId),
    foreignKey({
      name: 'email_submission_email_account_fk',
      columns: [t.emailId, t.mailAccountId],
      foreignColumns: [email.id, email.mailAccountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'email_submission_identity_account_fk',
      columns: [t.identityId, t.mailAccountId],
      foreignColumns: [mailIdentity.id, mailIdentity.mailAccountId],
    }).onDelete('restrict'),
    index('email_submission_account_status_send_idx').on(t.mailAccountId, t.status, t.sendAt),
    index('email_submission_account_created_id_idx').on(t.mailAccountId, t.createdAt, t.id),
    index('email_submission_account_identity_created_id_idx').on(
      t.mailAccountId,
      t.identityId,
      t.createdAt,
      t.id,
    ),
    index('email_submission_email_account_idx').on(t.emailId, t.mailAccountId),
    index('email_submission_identity_account_idx').on(t.identityId, t.mailAccountId),
    uniqueIndex('email_submission_account_idempotency_uidx').on(t.mailAccountId, t.idempotencyKey),
  ],
);

export const submissionBlob = createMailTable(
  'submission_blob',
  {
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    submissionId: text('submission_id').notNull(),
    blobId: text('blob_id').notNull(),
    kind: text('kind').$type<'raw' | 'text' | 'html' | 'part'>().notNull(),
    position: integer('position').notNull(),
    sha256: text('sha256').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    contentType: text('content_type').notNull(),
    objectKey: text('object_key').notNull(),
  },
  (t) => [
    check('submission_blob_kind_check', sql`${t.kind} IN ('raw', 'text', 'html', 'part')`),
    check('submission_blob_position_nonnegative_check', sql`${t.position} >= 0`),
    check('submission_blob_size_nonnegative_check', sql`${t.sizeBytes} >= 0`),
    unique('submission_blob_account_submission_kind_position_uidx').on(
      t.mailAccountId,
      t.submissionId,
      t.kind,
      t.position,
    ),
    foreignKey({
      name: 'submission_blob_submission_account_fk',
      columns: [t.submissionId, t.mailAccountId],
      foreignColumns: [emailSubmission.id, emailSubmission.mailAccountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'submission_blob_blob_account_fk',
      columns: [t.blobId, t.mailAccountId],
      foreignColumns: [blob.id, blob.mailAccountId],
    }).onDelete('restrict'),
    index('submission_blob_account_blob_idx').on(t.mailAccountId, t.blobId),
  ],
);
