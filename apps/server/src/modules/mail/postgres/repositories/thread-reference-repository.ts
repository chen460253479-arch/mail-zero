import type { ThreadReferenceRecord, ThreadReferenceRepository } from '@zero/mail-core';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { runAdapter, type MailDatabase } from './database';
import { threadReference } from '../schema';

const mapReference = (row: typeof threadReference.$inferSelect): ThreadReferenceRecord => ({
  accountId: row.mailAccountId as ThreadReferenceRecord['accountId'],
  normalizedSubjectHash: row.normalizedSubjectHash,
  messageIdHash: row.messageIdHash,
  emailId: row.emailId as ThreadReferenceRecord['emailId'],
  threadId: row.threadId as ThreadReferenceRecord['threadId'],
  createdAt: row.createdAt,
});

export const createThreadReferenceRepository = (db: MailDatabase): ThreadReferenceRepository => ({
  findCandidates: (input) =>
    runAdapter(async () => {
      const messageIdHashes = [...new Set(input.messageIdHashes)];
      if (messageIdHashes.length === 0) {
        return [];
      }
      return (
        await db
          .select()
          .from(threadReference)
          .where(
            and(
              eq(threadReference.mailAccountId, input.accountId),
              eq(threadReference.normalizedSubjectHash, input.normalizedSubjectHash),
              inArray(threadReference.messageIdHash, messageIdHashes),
            ),
          )
          .orderBy(asc(threadReference.messageIdHash), asc(threadReference.emailId))
      ).map(mapReference);
    }),
  insert: (record) =>
    runAdapter(async () => {
      await db
        .insert(threadReference)
        .values({
          mailAccountId: record.accountId,
          normalizedSubjectHash: record.normalizedSubjectHash,
          messageIdHash: record.messageIdHash,
          emailId: record.emailId,
          threadId: record.threadId,
          createdAt: record.createdAt,
        })
        .onConflictDoNothing();
    }),
  moveThread: (accountId, fromThreadId, toThreadId) =>
    runAdapter(async () => {
      await db
        .update(threadReference)
        .set({ threadId: toThreadId })
        .where(
          and(
            eq(threadReference.mailAccountId, accountId),
            eq(threadReference.threadId, fromThreadId),
          ),
        );
    }),
  deleteByEmail: (accountId, emailId) =>
    runAdapter(async () => {
      await db
        .delete(threadReference)
        .where(
          and(eq(threadReference.mailAccountId, accountId), eq(threadReference.emailId, emailId)),
        );
    }),
});
