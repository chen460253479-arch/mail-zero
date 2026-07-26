import type { ThreadQueryProjection, ThreadQueryRepository, ThreadRecord } from '@zero/mail-core';
import { and, asc, eq, exists, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { email, emailMailbox, mailboxThread, thread } from '../schema';
import { runAdapter, type MailDatabase } from './database';

type ThreadRow = typeof thread.$inferSelect;

const mapThread = (row: ThreadRow): ThreadRecord => ({
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

const hasVisibleMember = (
  db: MailDatabase,
  mailboxId: Parameters<ThreadQueryRepository['query']>[0]['mailboxId'],
) => {
  if (mailboxId === null) {
    return gt(thread.emailCount, 0);
  }
  return sql<boolean>`COALESCE((
    SELECT ${mailboxThread.emailCount} > 0
    FROM ${mailboxThread}
    WHERE ${mailboxThread.mailAccountId} = ${thread.mailAccountId}
      AND ${mailboxThread.mailboxId} = ${mailboxId}
      AND ${mailboxThread.threadId} = ${thread.id}
    LIMIT 1
  ), false)`;
};

const projectThreads = async (
  db: MailDatabase,
  rows: ThreadRow[],
): Promise<ThreadQueryProjection[]> => {
  if (rows.length === 0) {
    return [];
  }
  const accountId = rows[0]!.mailAccountId;
  const threadIds = rows.map(({ id }) => id);
  const visibleMembership = exists(
    db
      .select({ emailId: emailMailbox.emailId })
      .from(emailMailbox)
      .where(
        and(
          eq(emailMailbox.mailAccountId, email.mailAccountId),
          eq(emailMailbox.emailId, email.id),
        ),
      ),
  );
  const [emailRows, mailboxRows] = await Promise.all([
    db
      .select({ id: email.id, threadId: email.threadId })
      .from(email)
      .where(
        and(
          eq(email.mailAccountId, accountId),
          inArray(email.threadId, threadIds),
          isNull(email.destroyedAt),
          visibleMembership,
        ),
      )
      .orderBy(asc(email.receivedAt), asc(email.id)),
    db
      .select({ threadId: email.threadId, mailboxId: emailMailbox.mailboxId })
      .from(email)
      .innerJoin(
        emailMailbox,
        and(
          eq(emailMailbox.mailAccountId, email.mailAccountId),
          eq(emailMailbox.emailId, email.id),
        ),
      )
      .where(
        and(
          eq(email.mailAccountId, accountId),
          inArray(email.threadId, threadIds),
          isNull(email.destroyedAt),
        ),
      )
      .groupBy(email.threadId, emailMailbox.mailboxId)
      .orderBy(asc(emailMailbox.mailboxId)),
  ]);
  const emailIdsByThread = new Map<string, ThreadQueryProjection['emailIds']>();
  for (const row of emailRows) {
    const emailIds = emailIdsByThread.get(row.threadId) ?? [];
    emailIds.push(row.id as ThreadQueryProjection['emailIds'][number]);
    emailIdsByThread.set(row.threadId, emailIds);
  }
  const mailboxIdsByThread = new Map<string, ThreadQueryProjection['mailboxIds']>();
  for (const row of mailboxRows) {
    const mailboxIds = mailboxIdsByThread.get(row.threadId) ?? [];
    mailboxIds.push(row.mailboxId as ThreadQueryProjection['mailboxIds'][number]);
    mailboxIdsByThread.set(row.threadId, mailboxIds);
  }
  return rows.map((row) => ({
    ...mapThread(row),
    emailIds: emailIdsByThread.get(row.id) ?? [],
    mailboxIds: mailboxIdsByThread.get(row.id) ?? [],
  }));
};

export const createThreadQueryRepository = (db: MailDatabase): ThreadQueryRepository => ({
  query: (input) =>
    runAdapter(async () => {
      const cursor =
        input.after === null
          ? undefined
          : or(
              lt(thread.latestReceivedAt, input.after.latestReceivedAt),
              and(
                eq(thread.latestReceivedAt, input.after.latestReceivedAt),
                gt(thread.id, input.after.threadId),
              ),
            );
      const rows = await db
        .select()
        .from(thread)
        .where(
          and(
            eq(thread.mailAccountId, input.accountId),
            cursor,
            hasVisibleMember(db, input.mailboxId),
          ),
        )
        .orderBy(sql`${thread.latestReceivedAt} DESC NULLS LAST`, asc(thread.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      return {
        threads: await projectThreads(db, rows.slice(0, input.limit)),
        hasMore,
      };
    }),
  findById: (accountId, threadId) =>
    runAdapter(async () => {
      const rows = await db
        .select()
        .from(thread)
        .where(
          and(
            eq(thread.mailAccountId, accountId),
            eq(thread.id, threadId),
            hasVisibleMember(db, null),
          ),
        )
        .limit(1);
      if (rows.length === 0) {
        return null;
      }
      return (await projectThreads(db, rows))[0] ?? null;
    }),
});
