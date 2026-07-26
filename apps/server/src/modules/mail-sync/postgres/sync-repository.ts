import { and, asc, eq, exists, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { ulid } from 'ulid';

import type {
  AcquireSyncLeaseInput,
  ActivateSyncInput,
  ClaimPendingItemsInput,
  CreateActivatingSyncInput,
  InboundSyncItemRecord,
  InboundSyncRecord,
  MarkFailedInput,
  MarkImportedInput,
  PersistDiscoveryPageInput,
  ScheduleRetryInput,
  StoreActivationCheckpointInput,
} from './types';
import { parseIngressScope, parseVersionedProviderState } from '../domain/sync-state';
import { inboundSync, inboundSyncAttempt, inboundSyncItem } from './schema';
import { mailAccount } from '../../mail/postgres/schema/accounts';
import { MailSyncError } from '../domain/errors';
import { connection } from '../../../db/schema';
import type { DB } from '../../../db';

type RepositoryOptions = {
  newId?: () => string;
};

const leaseLost = (): never => {
  throw new MailSyncError('MAIL_SYNC_LEASE_LOST', 'retryable');
};

const syncNotFound = (): never => {
  throw new MailSyncError('MAIL_SYNC_NOT_FOUND', 'permanent');
};

const requirePositiveInteger = (value: number, code: string): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new MailSyncError(code, 'permanent');
  }
};

export const createPostgresMailSyncRepository = (db: DB, options: RepositoryOptions = {}) => {
  const newId = options.newId ?? ulid;

  const findSync = async (syncId: string): Promise<InboundSyncRecord | null> => {
    const rows = await db.select().from(inboundSync).where(eq(inboundSync.id, syncId)).limit(1);
    return rows[0] ?? null;
  };

  return {
    createActivatingSync: async (input: CreateActivatingSyncInput): Promise<InboundSyncRecord> => {
      const scope = parseIngressScope(input.scope);
      const rows = await db
        .insert(inboundSync)
        .values({
          id: newId(),
          accountId: input.accountId,
          provider: input.provider,
          scopeKey: input.scopeKey,
          scope,
          status: 'activating',
        })
        .onConflictDoNothing({
          target: [inboundSync.accountId, inboundSync.provider, inboundSync.scopeKey],
        })
        .returning();
      if (rows[0] !== undefined) {
        return rows[0];
      }
      const existing = await db
        .select()
        .from(inboundSync)
        .where(
          and(
            eq(inboundSync.accountId, input.accountId),
            eq(inboundSync.provider, input.provider),
            eq(inboundSync.scopeKey, input.scopeKey),
          ),
        )
        .limit(1);
      return existing[0] ?? syncNotFound();
    },

    storeActivationCheckpoint: async (
      input: StoreActivationCheckpointInput,
    ): Promise<InboundSyncRecord> => {
      const checkpoint = parseVersionedProviderState(input.checkpoint);
      const rows = await db
        .update(inboundSync)
        .set({ checkpoint, updatedAt: sql`now()` })
        .where(
          and(
            eq(inboundSync.id, input.syncId),
            eq(inboundSync.status, 'activating'),
            isNull(inboundSync.checkpoint),
          ),
        )
        .returning();
      if (rows[0] !== undefined) {
        return rows[0];
      }
      return (await findSync(input.syncId)) ?? syncNotFound();
    },

    activate: async (input: ActivateSyncInput): Promise<InboundSyncRecord> => {
      const rows = await db
        .update(inboundSync)
        .set({
          status: 'active',
          subscriptionExpiresAt: input.subscriptionExpiresAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(inboundSync.id, input.syncId),
            eq(inboundSync.status, 'activating'),
            sql`${inboundSync.checkpoint} IS NOT NULL`,
          ),
        )
        .returning();
      if (rows[0] !== undefined) {
        return rows[0];
      }
      const existing = await findSync(input.syncId);
      if (existing?.status === 'active') {
        return existing;
      }
      return syncNotFound();
    },

    acquireSyncLease: async (input: AcquireSyncLeaseInput): Promise<InboundSyncRecord | null> => {
      requirePositiveInteger(input.leaseForMs, 'MAIL_SYNC_INVALID_LEASE_DURATION');
      if (input.owner.length === 0) {
        throw new MailSyncError('MAIL_SYNC_INVALID_LEASE_OWNER', 'permanent');
      }
      const rows = await db
        .update(inboundSync)
        .set({
          leaseOwner: input.owner,
          leaseExpiresAt: sql`now() + (${input.leaseForMs} * interval '1 millisecond')`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(inboundSync.id, input.syncId),
            eq(inboundSync.status, 'active'),
            or(
              isNull(inboundSync.leaseExpiresAt),
              lte(inboundSync.leaseExpiresAt, sql`now()`),
              eq(inboundSync.leaseOwner, input.owner),
            ),
          ),
        )
        .returning();
      return rows[0] ?? null;
    },

    releaseSyncLease: async (input: { syncId: string; owner: string }): Promise<void> => {
      await db
        .update(inboundSync)
        .set({
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(inboundSync.id, input.syncId), eq(inboundSync.leaseOwner, input.owner)));
    },

    persistDiscoveryPage: async (
      input: PersistDiscoveryPageInput,
    ): Promise<{ inserted: number }> => {
      const checkpoint = parseVersionedProviderState(input.checkpoint);
      return db.transaction(async (transaction) => {
        const leased = await transaction
          .select({ id: inboundSync.id })
          .from(inboundSync)
          .where(
            and(
              eq(inboundSync.id, input.syncId),
              eq(inboundSync.leaseOwner, input.owner),
              gt(inboundSync.leaseExpiresAt, sql`now()`),
            ),
          )
          .for('update')
          .limit(1);
        if (leased.length === 0) {
          return leaseLost();
        }

        const uniqueEvents = [
          ...new Map(input.events.map((event) => [event.remoteMessageId, event] as const)).values(),
        ];
        const inserted =
          uniqueEvents.length === 0
            ? []
            : await transaction
                .insert(inboundSyncItem)
                .values(
                  uniqueEvents.map((event) => ({
                    id: newId(),
                    syncId: input.syncId,
                    remoteMessageId: event.remoteMessageId,
                    remoteThreadId: event.remoteThreadId,
                  })),
                )
                .onConflictDoNothing({
                  target: [inboundSyncItem.syncId, inboundSyncItem.remoteMessageId],
                })
                .returning({ id: inboundSyncItem.id });

        await transaction
          .update(inboundSync)
          .set({
            checkpoint,
            lastDiscoveredAt: sql`now()`,
            lastReconciledAt: sql`now()`,
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: sql`now()`,
          })
          .where(and(eq(inboundSync.id, input.syncId), eq(inboundSync.leaseOwner, input.owner)));
        return { inserted: inserted.length };
      });
    },

    claimPendingItems: async (input: ClaimPendingItemsInput): Promise<InboundSyncItemRecord[]> => {
      requirePositiveInteger(input.limit, 'MAIL_SYNC_INVALID_CLAIM_LIMIT');
      requirePositiveInteger(input.leaseForMs, 'MAIL_SYNC_INVALID_LEASE_DURATION');
      if (input.owner.length === 0) {
        throw new MailSyncError('MAIL_SYNC_INVALID_LEASE_OWNER', 'permanent');
      }

      return db.transaction(async (transaction) => {
        const activeStream = transaction
          .select({ id: inboundSync.id })
          .from(inboundSync)
          .where(and(eq(inboundSync.id, input.syncId), eq(inboundSync.status, 'active')));
        const candidates = await transaction
          .select({ id: inboundSyncItem.id })
          .from(inboundSyncItem)
          .where(
            and(
              eq(inboundSyncItem.syncId, input.syncId),
              exists(activeStream),
              or(
                and(
                  eq(inboundSyncItem.status, 'pending'),
                  lte(inboundSyncItem.nextAttemptAt, sql`now()`),
                ),
                and(
                  eq(inboundSyncItem.status, 'processing'),
                  lte(inboundSyncItem.leaseExpiresAt, sql`now()`),
                ),
              ),
            ),
          )
          .orderBy(asc(inboundSyncItem.nextAttemptAt), asc(inboundSyncItem.id))
          .for('update', { skipLocked: true })
          .limit(input.limit);
        if (candidates.length === 0) {
          return [];
        }

        return transaction
          .update(inboundSyncItem)
          .set({
            status: 'processing',
            attemptCount: sql`${inboundSyncItem.attemptCount} + 1`,
            leaseOwner: input.owner,
            leaseExpiresAt: sql`now() + (${input.leaseForMs} * interval '1 millisecond')`,
            updatedAt: sql`now()`,
          })
          .where(
            inArray(
              inboundSyncItem.id,
              candidates.map(({ id }) => id),
            ),
          )
          .returning();
      });
    },

    markImported: async (input: MarkImportedInput): Promise<void> => {
      await db.transaction(async (transaction) => {
        const rows = await transaction
          .update(inboundSyncItem)
          .set({
            status: 'imported',
            localEmailId: input.localEmailId,
            importedAt: sql`now()`,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(inboundSyncItem.id, input.itemId),
              eq(inboundSyncItem.status, 'processing'),
              eq(inboundSyncItem.leaseOwner, input.owner),
              gt(inboundSyncItem.leaseExpiresAt, sql`now()`),
            ),
          )
          .returning({ attemptCount: inboundSyncItem.attemptCount });
        const item = rows[0] ?? leaseLost();
        await transaction.insert(inboundSyncAttempt).values({
          id: newId(),
          itemId: input.itemId,
          attemptNumber: item.attemptCount,
          outcome: 'imported',
          startedAt: input.startedAt,
          finishedAt: sql`now()`,
        });
      });
    },

    scheduleRetry: async (input: ScheduleRetryInput): Promise<void> => {
      await db.transaction(async (transaction) => {
        const rows = await transaction
          .update(inboundSyncItem)
          .set({
            status: 'pending',
            nextAttemptAt: input.nextAttemptAt,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: input.errorCode,
            lastErrorMessage: input.errorMessage,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(inboundSyncItem.id, input.itemId),
              eq(inboundSyncItem.status, 'processing'),
              eq(inboundSyncItem.leaseOwner, input.owner),
              gt(inboundSyncItem.leaseExpiresAt, sql`now()`),
            ),
          )
          .returning({ attemptCount: inboundSyncItem.attemptCount });
        const item = rows[0] ?? leaseLost();
        await transaction.insert(inboundSyncAttempt).values({
          id: newId(),
          itemId: input.itemId,
          attemptNumber: item.attemptCount,
          outcome: 'retry',
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          startedAt: input.startedAt,
          finishedAt: sql`now()`,
        });
      });
    },

    markFailed: async (input: MarkFailedInput): Promise<void> => {
      await db.transaction(async (transaction) => {
        const rows = await transaction
          .update(inboundSyncItem)
          .set({
            status: 'failed',
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: input.errorCode,
            lastErrorMessage: input.errorMessage,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(inboundSyncItem.id, input.itemId),
              eq(inboundSyncItem.status, 'processing'),
              eq(inboundSyncItem.leaseOwner, input.owner),
              gt(inboundSyncItem.leaseExpiresAt, sql`now()`),
            ),
          )
          .returning({ attemptCount: inboundSyncItem.attemptCount });
        const item = rows[0] ?? leaseLost();
        await transaction.insert(inboundSyncAttempt).values({
          id: newId(),
          itemId: input.itemId,
          attemptNumber: item.attemptCount,
          outcome: 'failed',
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          startedAt: input.startedAt,
          finishedAt: sql`now()`,
        });
      });
    },

    pauseSync: async (input: {
      syncId: string;
      owner: string;
      errorCode: string;
      errorMessage: string;
    }): Promise<void> => {
      const rows = await db
        .update(inboundSync)
        .set({
          status: 'paused',
          lastErrorCode: input.errorCode,
          lastErrorMessage: input.errorMessage,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(inboundSync.id, input.syncId),
            eq(inboundSync.status, 'active'),
            eq(inboundSync.leaseOwner, input.owner),
            gt(inboundSync.leaseExpiresAt, sql`now()`),
          ),
        )
        .returning({ id: inboundSync.id });
      if (rows.length === 0) {
        leaseLost();
      }
    },

    markAuthError: async (input: {
      syncId: string;
      owner: string;
      errorCode: string;
      errorMessage: string;
    }): Promise<void> => {
      const rows = await db
        .update(inboundSync)
        .set({
          status: 'auth_error',
          lastErrorCode: input.errorCode,
          lastErrorMessage: input.errorMessage,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(inboundSync.id, input.syncId),
            eq(inboundSync.status, 'active'),
            eq(inboundSync.leaseOwner, input.owner),
            gt(inboundSync.leaseExpiresAt, sql`now()`),
          ),
        )
        .returning({ id: inboundSync.id });
      if (rows.length === 0) {
        leaseLost();
      }
    },

    recordSignal: async (input: {
      provider: string;
      externalAccount: string;
      cursorHint?: string;
    }): Promise<string[]> => {
      void input.cursorHint;
      return db.transaction(async (transaction) => {
        const matches = await transaction
          .select({ id: inboundSync.id })
          .from(inboundSync)
          .innerJoin(mailAccount, eq(mailAccount.id, inboundSync.accountId))
          .innerJoin(connection, eq(connection.id, mailAccount.connectionId))
          .where(
            and(
              eq(inboundSync.status, 'active'),
              eq(inboundSync.provider, input.provider),
              eq(connection.normalizedEmail, input.externalAccount),
            ),
          );
        if (matches.length === 0) {
          return [];
        }
        const ids = matches.map(({ id }) => id);
        await transaction
          .update(inboundSync)
          .set({ lastSignalAt: sql`now()`, updatedAt: sql`now()` })
          .where(inArray(inboundSync.id, ids));
        return ids;
      });
    },

    findDueReconciliations: async (input: { before: Date; limit: number }): Promise<string[]> => {
      requirePositiveInteger(input.limit, 'MAIL_SYNC_INVALID_DUE_LIMIT');
      return (
        await db
          .select({ id: inboundSync.id })
          .from(inboundSync)
          .where(
            and(
              eq(inboundSync.status, 'active'),
              or(
                isNull(inboundSync.lastReconciledAt),
                lte(inboundSync.lastReconciledAt, input.before),
              ),
            ),
          )
          .orderBy(sql`${inboundSync.lastReconciledAt} ASC NULLS FIRST`, asc(inboundSync.id))
          .limit(input.limit)
      ).map(({ id }) => id);
    },

    findDueRenewals: async (input: { before: Date; limit: number }): Promise<string[]> => {
      requirePositiveInteger(input.limit, 'MAIL_SYNC_INVALID_DUE_LIMIT');
      return (
        await db
          .select({ id: inboundSync.id })
          .from(inboundSync)
          .where(
            and(
              eq(inboundSync.status, 'active'),
              lte(inboundSync.subscriptionExpiresAt, input.before),
            ),
          )
          .orderBy(asc(inboundSync.subscriptionExpiresAt), asc(inboundSync.id))
          .limit(input.limit)
      ).map(({ id }) => id);
    },

    findSyncsWithDueItems: async (input: { before: Date; limit: number }): Promise<string[]> => {
      requirePositiveInteger(input.limit, 'MAIL_SYNC_INVALID_DUE_LIMIT');
      return (
        await db
          .selectDistinct({ id: inboundSyncItem.syncId })
          .from(inboundSyncItem)
          .innerJoin(inboundSync, eq(inboundSync.id, inboundSyncItem.syncId))
          .where(
            and(
              eq(inboundSync.status, 'active'),
              or(
                and(
                  eq(inboundSyncItem.status, 'pending'),
                  lte(inboundSyncItem.nextAttemptAt, input.before),
                ),
                and(
                  eq(inboundSyncItem.status, 'processing'),
                  lte(inboundSyncItem.leaseExpiresAt, input.before),
                ),
              ),
            ),
          )
          .orderBy(asc(inboundSyncItem.syncId))
          .limit(input.limit)
      ).map(({ id }) => id);
    },

    updateSubscription: async (input: {
      syncId: string;
      owner: string;
      subscriptionExpiresAt: Date | null;
    }): Promise<void> => {
      const rows = await db
        .update(inboundSync)
        .set({
          subscriptionExpiresAt: input.subscriptionExpiresAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(inboundSync.id, input.syncId),
            eq(inboundSync.status, 'active'),
            eq(inboundSync.leaseOwner, input.owner),
            gt(inboundSync.leaseExpiresAt, sql`now()`),
          ),
        )
        .returning({ id: inboundSync.id });
      if (rows.length === 0) {
        leaseLost();
      }
    },
  };
};

export type PostgresMailSyncRepository = ReturnType<typeof createPostgresMailSyncRepository>;
