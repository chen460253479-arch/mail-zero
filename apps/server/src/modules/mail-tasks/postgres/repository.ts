import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import type {
  ClaimedMailTask,
  EnqueueMailTaskInput,
  MailTaskQueue,
  MailTaskRepository,
} from '../domain/task';
import type { DB } from '../../../db';
import { mailTask } from './schema';

type MailTaskRepositoryFactories = {
  nextId(): string;
};

const liveStatuses = ['ready', 'running', 'retry'] as const;
const claimableStatuses = ['ready', 'retry'] as const;

const requirePositiveInteger = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('MAIL_TASK_INVALID_LIMIT');
  }
};

const mapClaimed = (row: typeof mailTask.$inferSelect): ClaimedMailTask => {
  if (row.leaseOwner === null || row.leaseExpiresAt === null) {
    throw new Error('MAIL_TASK_INVALID_LEASE');
  }
  return {
    id: row.id,
    queue: row.queue,
    command: row.payload,
    attempts: row.attempts,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt,
  };
};

export const createPostgresMailTaskRepository = (
  db: DB,
  factories: MailTaskRepositoryFactories,
): MailTaskRepository => ({
  enqueue: async (input: EnqueueMailTaskInput) => {
    const id = factories.nextId();
    const now = new Date();
    const inserted = await db
      .insert(mailTask)
      .values({
        id,
        queue: input.queue,
        type: input.command.type,
        payload: input.command,
        dedupeKey: input.dedupeKey,
        runAt: input.runAt ?? now,
        maxAttempts: input.maxAttempts ?? 5,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [mailTask.queue, mailTask.dedupeKey],
        where: sql`${mailTask.status} IN ('ready', 'running', 'retry')`,
      })
      .returning({ id: mailTask.id });
    if (inserted[0] !== undefined) {
      return { id: inserted[0].id, created: true };
    }
    const existing = await db
      .select({ id: mailTask.id })
      .from(mailTask)
      .where(
        and(
          eq(mailTask.queue, input.queue),
          eq(mailTask.dedupeKey, input.dedupeKey),
          inArray(mailTask.status, liveStatuses),
        ),
      )
      .limit(1);
    if (existing[0] === undefined) {
      throw new Error('MAIL_TASK_ENQUEUE_RACE');
    }
    return { id: existing[0].id, created: false };
  },

  claim: async (input) => {
    requirePositiveInteger(input.limit);
    requirePositiveInteger(input.leaseForMs);
    if (input.queues.length === 0) return [];
    return db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: mailTask.id })
        .from(mailTask)
        .where(
          and(
            inArray(mailTask.queue, input.queues),
            inArray(mailTask.status, claimableStatuses),
            lte(mailTask.runAt, input.now),
          ),
        )
        .orderBy(asc(mailTask.runAt), asc(mailTask.id))
        .limit(input.limit)
        .for('update', { skipLocked: true });
      if (candidates.length === 0) return [];
      const rows = await tx
        .update(mailTask)
        .set({
          status: 'running',
          attempts: sql`${mailTask.attempts} + 1`,
          leaseOwner: input.owner,
          leaseExpiresAt: new Date(input.now.getTime() + input.leaseForMs),
          updatedAt: input.now,
        })
        .where(
          and(
            inArray(
              mailTask.id,
              candidates.map(({ id }) => id),
            ),
            inArray(mailTask.status, claimableStatuses),
          ),
        )
        .returning();
      return rows
        .sort(
          (left, right) =>
            left.runAt.getTime() - right.runAt.getTime() || left.id.localeCompare(right.id),
        )
        .map(mapClaimed);
    });
  },

  complete: async (input) => {
    const rows = await db
      .delete(mailTask)
      .where(
        and(
          eq(mailTask.id, input.id),
          eq(mailTask.status, 'running'),
          eq(mailTask.leaseOwner, input.owner),
        ),
      )
      .returning({ id: mailTask.id });
    return rows.length === 1;
  },

  retry: async (input) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select({ attempts: mailTask.attempts, maxAttempts: mailTask.maxAttempts })
        .from(mailTask)
        .where(
          and(
            eq(mailTask.id, input.id),
            eq(mailTask.status, 'running'),
            eq(mailTask.leaseOwner, input.owner),
          ),
        )
        .limit(1)
        .for('update');
      const current = rows[0];
      if (current === undefined) return 'lost' as const;
      const exhausted = current.attempts >= current.maxAttempts;
      await tx
        .update(mailTask)
        .set({
          status: exhausted ? 'dead' : 'retry',
          runAt: input.runAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: input.errorCode,
          lastErrorMessage: input.errorMessage,
          updatedAt: input.now,
          completedAt: exhausted ? input.now : null,
        })
        .where(
          and(
            eq(mailTask.id, input.id),
            eq(mailTask.status, 'running'),
            eq(mailTask.leaseOwner, input.owner),
          ),
        );
      return exhausted ? ('dead' as const) : ('retry' as const);
    }),

  failPermanently: async (input) => {
    const rows = await db
      .update(mailTask)
      .set({
        status: 'dead',
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: input.errorCode,
        lastErrorMessage: input.errorMessage,
        updatedAt: input.now,
        completedAt: input.now,
      })
      .where(
        and(
          eq(mailTask.id, input.id),
          eq(mailTask.status, 'running'),
          eq(mailTask.leaseOwner, input.owner),
        ),
      )
      .returning({ id: mailTask.id });
    return rows.length === 1;
  },

  recoverExpired: async (input) => {
    requirePositiveInteger(input.limit);
    return db.transaction(async (tx) => {
      const expired = await tx
        .select({ id: mailTask.id })
        .from(mailTask)
        .where(and(eq(mailTask.status, 'running'), lte(mailTask.leaseExpiresAt, input.now)))
        .orderBy(asc(mailTask.leaseExpiresAt), asc(mailTask.id))
        .limit(input.limit)
        .for('update', { skipLocked: true });
      if (expired.length === 0) return 0;
      const rows = await tx
        .update(mailTask)
        .set({
          status: 'retry',
          runAt: input.now,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: input.now,
          lastErrorCode: 'MAIL_TASK_LEASE_EXPIRED',
          lastErrorMessage: 'The previous worker lease expired before completion',
        })
        .where(
          and(
            inArray(
              mailTask.id,
              expired.map(({ id }) => id),
            ),
            eq(mailTask.status, 'running'),
          ),
        )
        .returning({ id: mailTask.id });
      return rows.length;
    });
  },
});
