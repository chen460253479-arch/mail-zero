import { and, asc, eq, lte, ne, or } from 'drizzle-orm';

import type {
  MailSnoozeRepository,
  MailSnoozeTransactionRepository,
  SnoozeRecord,
} from '../domain/snooze';
import type { MailDatabase } from '../../mail/postgres/repositories/database';
import { threadSnooze } from './schema';
import type { DB } from '../../../db';

const map = (row: typeof threadSnooze.$inferSelect): SnoozeRecord => ({
  accountId: row.mailAccountId,
  threadId: row.threadId,
  wakeAt: row.wakeAt,
  restorePlan: row.restorePlan,
  status: row.status,
  leaseOwner: row.leaseOwner,
  leaseExpiresAt: row.leaseExpiresAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const createPostgresMailSnoozeTransactionRepository = (
  db: MailDatabase,
): MailSnoozeTransactionRepository => ({
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
        restorePlan: input.restorePlan,
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
          restorePlan: input.restorePlan,
          status: 'scheduled',
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: input.now,
        },
        setWhere: or(
          ne(threadSnooze.status, 'waking'),
          lte(threadSnooze.leaseExpiresAt, input.now),
        ),
      })
      .returning();
    if (rows[0] === undefined) throw new Error('SNOOZE_BUSY');
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
});

export const createPostgresMailSnoozeRepository = (db: DB): MailSnoozeRepository => ({
  ...createPostgresMailSnoozeTransactionRepository(db),
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
