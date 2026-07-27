import { and, asc, eq, exists, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { ulid } from 'ulid';

import type {
  AcquireSyncLeaseInput,
  ActivateSyncInput,
  ClaimDueDispatchesInput,
  ClaimPendingItemsInput,
  ClaimedMailSyncDispatch,
  CompleteDiscoveryRunInput,
  CreateActivatingSyncInput,
  InboundSyncItemRecord,
  InboundSyncRecord,
  MarkFailedInput,
  MarkImportedInput,
  PersistDiscoveryPageInput,
  ScheduleRetryInput,
  StoreActivationCheckpointInput,
} from './types';
import {
  parseIngressScope,
  parseVersionedProviderState,
  type VersionedProviderState,
} from '../domain/sync-state';
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

const decimalCursorPattern = /^\d+$/u;

const normalizeDecimalCursor = (value: string): string => {
  const normalized = value.replace(/^0+(?=\d)/u, '');
  return normalized.length === 0 ? '0' : normalized;
};

const mergeCursorHint = (current: string | null, incoming: string | undefined): string | null => {
  if (incoming === undefined) return current;
  if (current === null) return incoming;
  if (!decimalCursorPattern.test(current) || !decimalCursorPattern.test(incoming)) {
    return incoming;
  }

  const currentDecimal = normalizeDecimalCursor(current);
  const incomingDecimal = normalizeDecimalCursor(incoming);
  if (currentDecimal.length !== incomingDecimal.length) {
    return incomingDecimal.length > currentDecimal.length ? incoming : current;
  }
  return incomingDecimal > currentDecimal ? incoming : current;
};

export const createPostgresMailSyncRepository = (db: DB, options: RepositoryOptions = {}) => {
  const newId = options.newId ?? ulid;

  const findSync = async (syncId: string): Promise<InboundSyncRecord | null> => {
    const rows = await db.select().from(inboundSync).where(eq(inboundSync.id, syncId)).limit(1);
    return rows[0] ?? null;
  };

  const connectedAccount = db
    .select({ id: mailAccount.id })
    .from(mailAccount)
    .innerJoin(connection, eq(connection.id, mailAccount.connectionId))
    .where(and(eq(mailAccount.id, inboundSync.accountId), eq(connection.status, 'connected')));

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

    prepareActivation: async (input: { syncId: string }): Promise<InboundSyncRecord> => {
      const rows = await db
        .update(inboundSync)
        .set({
          status: 'activating',
          checkpoint: null,
          subscriptionExpiresAt: null,
          completedGeneration: inboundSync.requestedGeneration,
          pendingCursorHint: null,
          nextReconcileAt: sql`now()`,
          lastErrorCode: null,
          lastErrorMessage: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          dispatchLeaseOwner: null,
          dispatchLeaseExpiresAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(inboundSync.id, input.syncId),
            inArray(inboundSync.status, ['paused', 'auth_error']),
          ),
        )
        .returning();
      if (rows[0] !== undefined) {
        return rows[0];
      }
      const existing = await findSync(input.syncId);
      if (existing?.status === 'active' || existing?.status === 'activating') {
        return existing;
      }
      return syncNotFound();
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
          dispatchLeaseOwner: null,
          dispatchLeaseExpiresAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(inboundSync.id, input.syncId),
            eq(inboundSync.status, 'active'),
            exists(connectedAccount),
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

    renewSyncLease: async (input: AcquireSyncLeaseInput): Promise<boolean> => {
      requirePositiveInteger(input.leaseForMs, 'MAIL_SYNC_INVALID_LEASE_DURATION');
      if (input.owner.length === 0) {
        throw new MailSyncError('MAIL_SYNC_INVALID_LEASE_OWNER', 'permanent');
      }
      const rows = await db
        .update(inboundSync)
        .set({
          leaseExpiresAt: sql`now() + (${input.leaseForMs} * interval '1 millisecond')`,
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
      return rows.length === 1;
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
            lastDiscoveredAt: sql`now()`,
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: sql`now()`,
          })
          .where(and(eq(inboundSync.id, input.syncId), eq(inboundSync.leaseOwner, input.owner)));
        return { inserted: inserted.length };
      });
    },

    completeDiscoveryRun: async (
      input: CompleteDiscoveryRunInput,
    ): Promise<{
      requestedGeneration: number;
      completedGeneration: number;
      checkpoint: VersionedProviderState;
    }> => {
      requirePositiveInteger(input.reconcileAfterMs, 'MAIL_SYNC_INVALID_RECONCILE_DELAY');
      if (!Number.isSafeInteger(input.completedGeneration) || input.completedGeneration < 0) {
        throw new MailSyncError('MAIL_SYNC_INVALID_GENERATION', 'permanent');
      }
      const checkpoint = parseVersionedProviderState(input.checkpoint);
      return db.transaction(async (transaction) => {
        const rows = await transaction
          .select({
            requestedGeneration: inboundSync.requestedGeneration,
            completedGeneration: inboundSync.completedGeneration,
          })
          .from(inboundSync)
          .where(
            and(
              eq(inboundSync.id, input.syncId),
              eq(inboundSync.status, 'active'),
              eq(inboundSync.leaseOwner, input.owner),
              gt(inboundSync.leaseExpiresAt, sql`now()`),
            ),
          )
          .for('update')
          .limit(1);
        const current = rows[0] ?? leaseLost();
        if (
          input.completedGeneration < current.completedGeneration ||
          input.completedGeneration > current.requestedGeneration
        ) {
          throw new MailSyncError('MAIL_SYNC_INVALID_GENERATION', 'permanent');
        }

        const updated = await transaction
          .update(inboundSync)
          .set({
            checkpoint,
            completedGeneration: input.completedGeneration,
            pendingCursorHint: sql`CASE
              WHEN ${inboundSync.requestedGeneration} <= ${input.completedGeneration}
              THEN NULL
              ELSE ${inboundSync.pendingCursorHint}
            END`,
            lastDiscoveredAt: sql`now()`,
            lastReconciledAt: sql`now()`,
            nextReconcileAt: sql`now() + (${input.reconcileAfterMs} * interval '1 millisecond')`,
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(inboundSync.id, input.syncId),
              eq(inboundSync.leaseOwner, input.owner),
              gt(inboundSync.leaseExpiresAt, sql`now()`),
            ),
          )
          .returning({
            requestedGeneration: inboundSync.requestedGeneration,
            completedGeneration: inboundSync.completedGeneration,
            checkpoint: inboundSync.checkpoint,
          });
        const result = updated[0] ?? leaseLost();
        return {
          ...result,
          checkpoint: parseVersionedProviderState(result.checkpoint),
        };
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
          .innerJoin(mailAccount, eq(mailAccount.id, inboundSync.accountId))
          .innerJoin(connection, eq(connection.id, mailAccount.connectionId))
          .where(
            and(
              eq(inboundSync.id, input.syncId),
              eq(inboundSync.status, 'active'),
              eq(connection.status, 'connected'),
            ),
          );
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

    pauseConnectionSyncs: async (input: {
      userId: string;
      connectionId: string;
      errorCode: string;
      errorMessage: string;
    }): Promise<number> =>
      await db.transaction(async (transaction) => {
        const accounts = await transaction
          .select({ id: mailAccount.id })
          .from(mailAccount)
          .innerJoin(connection, eq(connection.id, mailAccount.connectionId))
          .where(and(eq(connection.id, input.connectionId), eq(connection.userId, input.userId)));
        if (accounts.length === 0) {
          return 0;
        }
        const rows = await transaction
          .update(inboundSync)
          .set({
            status: 'paused',
            subscriptionExpiresAt: null,
            lastErrorCode: input.errorCode,
            lastErrorMessage: input.errorMessage,
            leaseOwner: null,
            leaseExpiresAt: null,
            updatedAt: sql`now()`,
          })
          .where(
            inArray(
              inboundSync.accountId,
              accounts.map(({ id }) => id),
            ),
          )
          .returning({ id: inboundSync.id });
        return rows.length;
      }),

    recordSignal: async (input: {
      provider: string;
      externalAccount: string;
      cursorHint?: string;
    }): Promise<string[]> => {
      return db.transaction(async (transaction) => {
        const matches = await transaction
          .select({
            id: inboundSync.id,
            pendingCursorHint: inboundSync.pendingCursorHint,
          })
          .from(inboundSync)
          .innerJoin(mailAccount, eq(mailAccount.id, inboundSync.accountId))
          .innerJoin(connection, eq(connection.id, mailAccount.connectionId))
          .where(
            and(
              eq(inboundSync.status, 'active'),
              eq(inboundSync.provider, input.provider),
              eq(connection.normalizedEmail, input.externalAccount),
              eq(connection.status, 'connected'),
            ),
          )
          .for('update', { of: inboundSync });
        if (matches.length === 0) {
          return [];
        }
        const updated: string[] = [];
        for (const { id, pendingCursorHint } of matches) {
          const rows = await transaction
            .update(inboundSync)
            .set({
              requestedGeneration: sql`${inboundSync.requestedGeneration} + 1`,
              pendingCursorHint: mergeCursorHint(pendingCursorHint, input.cursorHint),
              lastSignalAt: sql`now()`,
              updatedAt: sql`now()`,
            })
            .where(and(eq(inboundSync.id, id), eq(inboundSync.status, 'active')))
            .returning({ id: inboundSync.id });
          if (rows[0] !== undefined) {
            updated.push(rows[0].id);
          }
        }
        return updated;
      });
    },

    claimDueDispatches: async (
      input: ClaimDueDispatchesInput,
    ): Promise<ClaimedMailSyncDispatch[]> => {
      requirePositiveInteger(input.limit, 'MAIL_SYNC_INVALID_DUE_LIMIT');
      requirePositiveInteger(input.leaseForMs, 'MAIL_SYNC_INVALID_LEASE_DURATION');
      if (input.owner.length === 0) {
        throw new MailSyncError('MAIL_SYNC_INVALID_LEASE_OWNER', 'permanent');
      }

      return db.transaction(async (transaction) => {
        const dueItems = transaction
          .select({ id: inboundSyncItem.id })
          .from(inboundSyncItem)
          .where(
            and(
              eq(inboundSyncItem.syncId, inboundSync.id),
              or(
                and(
                  eq(inboundSyncItem.status, 'pending'),
                  lte(inboundSyncItem.nextAttemptAt, input.importBefore),
                ),
                and(
                  eq(inboundSyncItem.status, 'processing'),
                  lte(inboundSyncItem.leaseExpiresAt, input.importBefore),
                ),
              ),
            ),
          );
        const candidates = await transaction
          .select({
            id: inboundSync.id,
            requestedGeneration: inboundSync.requestedGeneration,
            completedGeneration: inboundSync.completedGeneration,
            discover: sql<boolean>`(
              ${inboundSync.requestedGeneration} > ${inboundSync.completedGeneration}
              OR ${inboundSync.nextReconcileAt} <= ${input.reconcileBefore}
            )`,
            renew: sql<boolean>`(
              ${inboundSync.subscriptionExpiresAt} IS NOT NULL
              AND ${inboundSync.subscriptionExpiresAt} <= ${input.renewalBefore}
            )`,
            importPending: sql<boolean>`EXISTS (${dueItems})`,
          })
          .from(inboundSync)
          .innerJoin(mailAccount, eq(mailAccount.id, inboundSync.accountId))
          .innerJoin(connection, eq(connection.id, mailAccount.connectionId))
          .where(
            and(
              eq(inboundSync.status, 'active'),
              eq(connection.status, 'connected'),
              or(
                isNull(inboundSync.dispatchLeaseExpiresAt),
                lte(inboundSync.dispatchLeaseExpiresAt, sql`now()`),
              ),
              or(
                gt(inboundSync.requestedGeneration, inboundSync.completedGeneration),
                lte(inboundSync.nextReconcileAt, input.reconcileBefore),
                lte(inboundSync.subscriptionExpiresAt, input.renewalBefore),
                exists(dueItems),
              ),
            ),
          )
          .orderBy(asc(inboundSync.nextReconcileAt), asc(inboundSync.id))
          .for('update', { of: inboundSync, skipLocked: true })
          .limit(input.limit);

        const claimed: ClaimedMailSyncDispatch[] = [];
        for (const candidate of candidates) {
          const rows = await transaction
            .update(inboundSync)
            .set({
              requestedGeneration:
                candidate.discover &&
                candidate.requestedGeneration === candidate.completedGeneration
                  ? candidate.requestedGeneration + 1
                  : candidate.requestedGeneration,
              dispatchLeaseOwner: input.owner,
              dispatchLeaseExpiresAt: sql`now() + (${input.leaseForMs} * interval '1 millisecond')`,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(inboundSync.id, candidate.id),
                eq(inboundSync.status, 'active'),
                or(
                  isNull(inboundSync.dispatchLeaseExpiresAt),
                  lte(inboundSync.dispatchLeaseExpiresAt, sql`now()`),
                ),
              ),
            )
            .returning({ id: inboundSync.id });
          if (rows.length === 1) {
            claimed.push({
              syncId: candidate.id,
              discover: candidate.discover,
              renew: candidate.renew,
              importPending: candidate.importPending,
            });
          }
        }
        return claimed;
      });
    },

    confirmDispatch: async (input: {
      syncId: string;
      owner: string;
      leaseForMs: number;
    }): Promise<boolean> => {
      requirePositiveInteger(input.leaseForMs, 'MAIL_SYNC_INVALID_LEASE_DURATION');
      const rows = await db
        .update(inboundSync)
        .set({
          dispatchLeaseExpiresAt: sql`now() + (${input.leaseForMs} * interval '1 millisecond')`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(inboundSync.id, input.syncId),
            eq(inboundSync.dispatchLeaseOwner, input.owner),
            gt(inboundSync.dispatchLeaseExpiresAt, sql`now()`),
          ),
        )
        .returning({ id: inboundSync.id });
      return rows.length === 1;
    },

    deferDispatch: async (input: {
      syncId: string;
      owner: string;
      retryAfterMs: number;
    }): Promise<void> => {
      requirePositiveInteger(input.retryAfterMs, 'MAIL_SYNC_INVALID_DISPATCH_RETRY_DELAY');
      await db
        .update(inboundSync)
        .set({
          dispatchLeaseExpiresAt: sql`now() + (${input.retryAfterMs} * interval '1 millisecond')`,
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(inboundSync.id, input.syncId), eq(inboundSync.dispatchLeaseOwner, input.owner)),
        );
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
