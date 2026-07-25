import type { ThreadRecord, ThreadRepository } from '@zero/mail-core';
import { and, asc, eq, ne } from 'drizzle-orm';

import { requireRow, runAdapter, type MailDatabase } from './database';
import { thread } from '../schema';

const mapThread = (row: typeof thread.$inferSelect): ThreadRecord => ({
  id: row.id as ThreadRecord['id'],
  accountId: row.mailAccountId as ThreadRecord['accountId'],
  normalizedSubject: row.normalizedSubject,
  latestReceivedAt: row.latestReceivedAt,
  emailCount: row.emailCount,
  unreadCount: row.unreadCount,
  hasAttachment: row.hasAttachment,
  participantSummary: row.participantSummary,
  preview: row.preview,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const createThreadRepository = (db: MailDatabase): ThreadRepository => ({
  findById: (accountId, id) =>
    runAdapter(async () => {
      const rows = await db
        .select()
        .from(thread)
        .where(and(eq(thread.mailAccountId, accountId), eq(thread.id, id)))
        .limit(1);
      return rows[0] === undefined ? null : mapThread(rows[0]);
    }),
  existsOutsideAccount: (accountId, id) =>
    runAdapter(async () => {
      const rows = await db
        .select({ id: thread.id })
        .from(thread)
        .where(and(eq(thread.id, id), ne(thread.mailAccountId, accountId)))
        .limit(1);
      return rows.length > 0;
    }),
  listByAccount: (accountId) =>
    runAdapter(async () =>
      (
        await db
          .select()
          .from(thread)
          .where(eq(thread.mailAccountId, accountId))
          .orderBy(asc(thread.latestReceivedAt), asc(thread.id))
      ).map(mapThread),
    ),
  insert: (record) =>
    runAdapter(async () => {
      const rows = await db
        .insert(thread)
        .values({ ...record, mailAccountId: record.accountId })
        .returning();
      return mapThread(requireRow(rows, 'STORAGE_FAILURE'));
    }),
  update: (accountId, id, patch) =>
    runAdapter(async () => {
      const rows = await db
        .update(thread)
        .set(patch)
        .where(and(eq(thread.mailAccountId, accountId), eq(thread.id, id)))
        .returning();
      return mapThread(requireRow(rows, 'THREAD_NOT_FOUND', id));
    }),
  delete: (accountId, id) =>
    runAdapter(async () => {
      await db.delete(thread).where(and(eq(thread.mailAccountId, accountId), eq(thread.id, id)));
    }),
});
