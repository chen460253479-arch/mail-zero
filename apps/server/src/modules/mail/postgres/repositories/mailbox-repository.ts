import type { MailboxRecord, MailboxRepository } from '@zero/mail-core';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';

import { requireRow, runAdapter, type MailDatabase } from './database';
import { emailMailbox, mailbox } from '../schema';

const mapMailbox = (row: typeof mailbox.$inferSelect): MailboxRecord => ({
  id: row.id as MailboxRecord['id'],
  accountId: row.mailAccountId as MailboxRecord['accountId'],
  parentId: row.parentId as MailboxRecord['parentId'],
  name: row.name,
  normalizedName: row.normalizedName,
  kind: row.kind,
  role: row.role,
  color: row.color,
  sortOrder: row.sortOrder,
  isSubscribed: row.isSubscribed,
  totalEmails: row.totalEmails,
  unreadEmails: row.unreadEmails,
  totalThreads: row.totalThreads,
  unreadThreads: row.unreadThreads,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
});

export const createMailboxRepository = (db: MailDatabase): MailboxRepository => ({
  findById: (accountId, id) =>
    runAdapter(async () => {
      const rows = await db
        .select()
        .from(mailbox)
        .where(and(eq(mailbox.mailAccountId, accountId), eq(mailbox.id, id)))
        .limit(1);
      return rows[0] === undefined ? null : mapMailbox(rows[0]);
    }),
  findByRole: (accountId, role) =>
    runAdapter(async () => {
      const rows = await db
        .select()
        .from(mailbox)
        .where(
          and(
            eq(mailbox.mailAccountId, accountId),
            eq(mailbox.role, role),
            isNull(mailbox.deletedAt),
          ),
        )
        .limit(1);
      return rows[0] === undefined ? null : mapMailbox(rows[0]);
    }),
  findByNormalizedName: (accountId, parentId, normalizedName) =>
    runAdapter(async () => {
      const parentPredicate =
        parentId === null ? isNull(mailbox.parentId) : eq(mailbox.parentId, parentId);
      const rows = await db
        .select()
        .from(mailbox)
        .where(
          and(
            eq(mailbox.mailAccountId, accountId),
            parentPredicate,
            eq(mailbox.normalizedName, normalizedName),
            isNull(mailbox.deletedAt),
          ),
        )
        .limit(1);
      return rows[0] === undefined ? null : mapMailbox(rows[0]);
    }),
  existsOutsideAccount: (accountId, id) =>
    runAdapter(async () => {
      const rows = await db
        .select({ id: mailbox.id })
        .from(mailbox)
        .where(and(eq(mailbox.id, id), ne(mailbox.mailAccountId, accountId)))
        .limit(1);
      return rows.length > 0;
    }),
  hasChild: (accountId, id) =>
    runAdapter(async () => {
      const rows = await db
        .select({ id: mailbox.id })
        .from(mailbox)
        .where(and(eq(mailbox.mailAccountId, accountId), eq(mailbox.parentId, id)))
        .limit(1);
      return rows.length > 0;
    }),
  hasEmail: (accountId, id) =>
    runAdapter(async () => {
      const rows = await db
        .select({ emailId: emailMailbox.emailId })
        .from(emailMailbox)
        .where(and(eq(emailMailbox.mailAccountId, accountId), eq(emailMailbox.mailboxId, id)))
        .limit(1);
      return rows.length > 0;
    }),
  listByAccount: (accountId) =>
    runAdapter(async () =>
      (
        await db
          .select()
          .from(mailbox)
          .where(eq(mailbox.mailAccountId, accountId))
          .orderBy(asc(mailbox.sortOrder), asc(mailbox.id))
      ).map(mapMailbox),
    ),
  insert: (record) =>
    runAdapter(async () => {
      const rows = await db
        .insert(mailbox)
        .values({ ...record, mailAccountId: record.accountId })
        .returning();
      return mapMailbox(requireRow(rows, 'STORAGE_FAILURE'));
    }),
  update: (accountId, id, patch) =>
    runAdapter(async () => {
      const rows = await db
        .update(mailbox)
        .set(patch)
        .where(and(eq(mailbox.mailAccountId, accountId), eq(mailbox.id, id)))
        .returning();
      return mapMailbox(requireRow(rows, 'MAILBOX_NOT_FOUND', id));
    }),
  delete: (accountId, id) =>
    runAdapter(async () => {
      await db.delete(mailbox).where(and(eq(mailbox.mailAccountId, accountId), eq(mailbox.id, id)));
    }),
});
