import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { createMailTable } from '../table';
import { mailAccount } from './accounts';
import { blob } from './blobs';
import { mailbox } from './mailboxes';
import { thread } from './threads';

export const email = createMailTable(
  'email',
  {
    id: text('id').primaryKey(),
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').notNull(),
    blobId: text('blob_id'),
    messageIdHeader: text('message_id_header'),
    inReplyTo: text('in_reply_to'),
    references: text('references').array(),
    subject: text('subject'),
    preview: text('preview'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    hasAttachment: boolean('has_attachment').notNull().default(false),
    lifecycle: text('lifecycle').$type<'draft' | 'received' | 'sent'>().notNull(),
    draftRevision: integer('draft_revision').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    destroyedAt: timestamp('destroyed_at', { withTimezone: true }),
  },
  (t) => [
    unique('email_id_account_uidx').on(t.id, t.mailAccountId),
    foreignKey({
      name: 'email_thread_account_fk',
      columns: [t.threadId, t.mailAccountId],
      foreignColumns: [thread.id, thread.mailAccountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'email_blob_account_fk',
      columns: [t.blobId, t.mailAccountId],
      foreignColumns: [blob.id, blob.mailAccountId],
    }).onDelete('restrict'),
    index('email_account_received_id_idx').on(t.mailAccountId, t.receivedAt.desc(), t.id.desc()),
    index('email_account_thread_received_id_idx').on(
      t.mailAccountId,
      t.threadId,
      t.receivedAt,
      t.id,
    ),
  ],
);

export const emailAddress = createMailTable(
  'email_address',
  {
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    emailId: text('email_id').notNull(),
    kind: text('kind')
      .$type<'sender' | 'from' | 'to' | 'cc' | 'bcc' | 'reply_to'>()
      .notNull(),
    position: integer('position').notNull(),
    name: text('name'),
    address: text('email').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'email_address_pk',
      columns: [t.mailAccountId, t.emailId, t.kind, t.position],
    }),
    foreignKey({
      name: 'email_address_email_account_fk',
      columns: [t.emailId, t.mailAccountId],
      foreignColumns: [email.id, email.mailAccountId],
    }).onDelete('cascade'),
  ],
);

export const emailMailbox = createMailTable(
  'email_mailbox',
  {
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    emailId: text('email_id').notNull(),
    mailboxId: text('mailbox_id').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'email_mailbox_pk',
      columns: [t.emailId, t.mailboxId],
    }),
    foreignKey({
      name: 'email_mailbox_email_account_fk',
      columns: [t.emailId, t.mailAccountId],
      foreignColumns: [email.id, email.mailAccountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'email_mailbox_mailbox_account_fk',
      columns: [t.mailboxId, t.mailAccountId],
      foreignColumns: [mailbox.id, mailbox.mailAccountId],
    }).onDelete('cascade'),
    index('email_mailbox_account_mailbox_email_idx').on(
      t.mailAccountId,
      t.mailboxId,
      t.emailId,
    ),
  ],
);

export const emailTrashRestore = createMailTable(
  'email_trash_restore',
  {
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    emailId: text('email_id').notNull(),
    mailboxId: text('mailbox_id').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'email_trash_restore_pk',
      columns: [t.emailId, t.mailboxId],
    }),
    foreignKey({
      name: 'email_trash_restore_email_account_fk',
      columns: [t.emailId, t.mailAccountId],
      foreignColumns: [email.id, email.mailAccountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'email_trash_restore_mailbox_account_fk',
      columns: [t.mailboxId, t.mailAccountId],
      foreignColumns: [mailbox.id, mailbox.mailAccountId],
    }).onDelete('cascade'),
    index('email_trash_restore_account_email_mailbox_idx').on(
      t.mailAccountId,
      t.emailId,
      t.mailboxId,
    ),
  ],
);

export const emailKeyword = createMailTable(
  'email_keyword',
  {
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    emailId: text('email_id').notNull(),
    keyword: text('keyword').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'email_keyword_pk',
      columns: [t.emailId, t.keyword],
    }),
    foreignKey({
      name: 'email_keyword_email_account_fk',
      columns: [t.emailId, t.mailAccountId],
      foreignColumns: [email.id, email.mailAccountId],
    }).onDelete('cascade'),
    index('email_keyword_account_keyword_email_idx').on(
      t.mailAccountId,
      t.keyword,
      t.emailId,
    ),
  ],
);

export const emailContent = createMailTable(
  'email_content',
  {
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    emailId: text('email_id').notNull(),
    parserVersion: integer('parser_version').notNull(),
    textBlobId: text('text_blob_id'),
    htmlBlobId: text('html_blob_id'),
    preview: text('preview'),
    parseWarnings: text('parse_warnings').array(),
    parsedAt: timestamp('parsed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'email_content_pk',
      columns: [t.mailAccountId, t.emailId],
    }),
    foreignKey({
      name: 'email_content_email_account_fk',
      columns: [t.emailId, t.mailAccountId],
      foreignColumns: [email.id, email.mailAccountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'email_content_text_blob_account_fk',
      columns: [t.textBlobId, t.mailAccountId],
      foreignColumns: [blob.id, blob.mailAccountId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'email_content_html_blob_account_fk',
      columns: [t.htmlBlobId, t.mailAccountId],
      foreignColumns: [blob.id, blob.mailAccountId],
    }).onDelete('restrict'),
  ],
);

export const emailPart = createMailTable(
  'email_part',
  {
    id: text('id').primaryKey(),
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    emailId: text('email_id').notNull(),
    parentPartId: text('parent_part_id'),
    partPath: text('part_path').notNull(),
    contentType: text('content_type').notNull(),
    charset: text('charset'),
    disposition: text('disposition').$type<'inline' | 'attachment'>(),
    filename: text('filename'),
    contentId: text('content_id'),
    blobId: text('blob_id'),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    kind: text('kind').$type<'body' | 'inline' | 'attachment'>().notNull(),
  },
  (t) => [
    unique('email_part_id_account_uidx').on(t.id, t.mailAccountId),
    unique('email_part_id_email_account_uidx').on(t.id, t.emailId, t.mailAccountId),
    unique('email_part_account_email_path_uidx').on(t.mailAccountId, t.emailId, t.partPath),
    foreignKey({
      name: 'email_part_email_account_fk',
      columns: [t.emailId, t.mailAccountId],
      foreignColumns: [email.id, email.mailAccountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'email_part_parent_account_fk',
      columns: [t.parentPartId, t.emailId, t.mailAccountId],
      foreignColumns: [t.id, t.emailId, t.mailAccountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'email_part_blob_account_fk',
      columns: [t.blobId, t.mailAccountId],
      foreignColumns: [blob.id, blob.mailAccountId],
    }).onDelete('restrict'),
  ],
);

export const remoteEmail = createMailTable(
  'remote_email',
  {
    mailAccountId: text('mail_account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<'google' | 'microsoft' | 'zoho' | 'imap'>().notNull(),
    remoteEmailId: text('remote_email_id').notNull(),
    remoteThreadId: text('remote_thread_id'),
    emailId: text('email_id').notNull(),
    contentFingerprint: text('content_fingerprint'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'remote_email_email_account_fk',
      columns: [t.emailId, t.mailAccountId],
      foreignColumns: [email.id, email.mailAccountId],
    }).onDelete('cascade'),
    uniqueIndex('remote_email_account_provider_remote_uidx').on(
      t.mailAccountId,
      t.provider,
      t.remoteEmailId,
    ),
  ],
);
