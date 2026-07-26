import { and, asc, eq, lte, or } from 'drizzle-orm';

import type { MailSnoozeRepository, SnoozeRecord } from '../domain/snooze';
import { threadSnooze } from './schema';
import type { DB } from '../../../db';

const map = (row: typeof threadSnooze.$inferSelect): SnoozeRecord => ({
  accountId: row.mailAccountId,
  threadId: row.threadId,
  wakeAt: row.wakeAt,
  restoreMailboxIds: row.restoreMailboxIds,
  status: row.status,
  leaseOwner: row.leaseOwner,
  leaseExpiresAt: row.leaseExpiresAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const createPostgresMailSnoozeRepository = (db: DB): MailSnoozeRepository => ({
  async find(accountId, threadId) {
    const rows = await db
      .select()
      .from(threadSnooze)
      .where(and(eq(threadSnooze.mailAccountId, accountId), eq(threadSnooze.threadId, threadId)))
      .limit(1);
    return rows[0] === undefined ? null : map(rows[0]);
  },
  async schedule(input) {
    const rows = await db
      .insert(threadSnooze)
      .values({
        mailAccountId: input.accountId,
        threadId: input.threadId,
        wakeAt: input.wakeAt,
        restoreMailboxIds: input.restoreMailboxIds,
        status: 'scheduled',
        leaseOwner: null,
        leaseExpiresAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [threadSnooze.mailAccountId, threadSnooze.threadId],
        set: {
          wakeAt: input.wakeAt,
          restoreMailboxIds: input.restoreMailboxIds,
          status: 'scheduled',
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: input.now,
        },
      })
      .returning();
    return map(rows[0]!);
  },
  async cancel(input) {
    await db
      .update(threadSnooze)
      .set({
        status: 'canceled',
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(threadSnooze.mailAccountId, input.accountId),
          eq(threadSnooze.threadId, input.threadId),
        ),
      );
  },
  async claimDue(input) {
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseForMs);
    return db.transaction(async (tx) => {
      const due = await tx
        .select({
          accountId: threadSnooze.mailAccountId,
          threadId: threadSnooze.threadId,
        })
        .from(threadSnooze)
        .where(
          or(
            and(eq(threadSnooze.status, 'scheduled'), lte(threadSnooze.wakeAt, input.now)),
            and(eq(threadSnooze.status, 'waking'), lte(threadSnooze.leaseExpiresAt, input.now)),
          ),
        )
        .orderBy(asc(threadSnooze.wakeAt), asc(threadSnooze.threadId))
        .limit(input.limit)
        .for('update', { skipLocked: true });
      const claimed: SnoozeRecord[] = [];
      for (const item of due) {
        const rows = await tx
          .update(threadSnooze)
          .set({
            status: 'waking',
            leaseOwner: input.leaseOwner,
            leaseExpiresAt,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(threadSnooze.mailAccountId, item.accountId),
              eq(threadSnooze.threadId, item.threadId),
            ),
          )
          .returning();
        if (rows[0] !== undefined) claimed.push(map(rows[0]));
      }
      return claimed;
    });
  },
  async complete(input) {
    await db
      .update(threadSnooze)
      .set({
        status: 'completed',
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(threadSnooze.mailAccountId, input.accountId),
          eq(threadSnooze.threadId, input.threadId),
          eq(threadSnooze.status, 'waking'),
          eq(threadSnooze.leaseOwner, input.leaseOwner),
        ),
      );
  },
  async release(input) {
    await db
      .update(threadSnooze)
      .set({
        status: 'scheduled',
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(threadSnooze.mailAccountId, input.accountId),
          eq(threadSnooze.threadId, input.threadId),
          eq(threadSnooze.status, 'waking'),
          eq(threadSnooze.leaseOwner, input.leaseOwner),
        ),
      );
  },
});
