import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

import type {
  ClaimedDelivery,
  LeaseIdentity,
  OutboundAttemptKind,
  OutboundAttemptOutcome,
  OutboundDeliveryRecord,
  OutboundDeliveryStatus,
} from '../domain/delivery';
import type {
  OutboundEnvelope,
  OutboundErrorClassification,
} from '../../../mail-channel/contracts';
import { emailSubmission, submissionBlob } from '../../mail/postgres/schema/submissions';
import { email, emailAddress, remoteEmail } from '../../mail/postgres/schema/emails';
import type { MailDatabase } from '../../mail/postgres/repositories/database';
import { outboundDelivery, sendAttempt } from './schema';
import { MailOutboundError } from '../domain/errors';
import { connection } from '../../../db/schema';

export type InsertOutboundDelivery = {
  id: string;
  mailAccountId: string;
  submissionId: string;
  connectionId: string;
  status: 'scheduled' | 'ready';
  availableAt: Date;
  now: Date;
};

export type ClaimDeliveryInput = {
  deliveryId: string;
  owner: string;
  leaseForMs: number;
  attemptKind: OutboundAttemptKind;
  now: Date;
};

export type FrozenRawBlobReference = {
  blobId: string;
  objectKey: string;
  sha256: string;
  sizeBytes: bigint;
  contentType: string;
};

export type OutboundMessageSnapshot = {
  delivery: OutboundDeliveryRecord;
  channelId: string;
  envelope: OutboundEnvelope;
  messageId: string;
  raw: FrozenRawBlobReference;
  remoteThreadReferences: readonly {
    provider: string;
    remoteThreadId: string;
  }[];
};

export type FinishAttemptInput = LeaseIdentity & {
  outcome: OutboundAttemptOutcome;
  finishedAt: Date;
  providerCode?: string | null;
  safeResponse?: string | null;
  retryAt?: Date | null;
  remoteMessageId?: string | null;
  remoteThreadId?: string | null;
};

export type ScheduleDeliveryRetryInput = LeaseIdentity & {
  retryAt: Date;
  now: Date;
  error: OutboundErrorClassification;
};

export type MarkDeliveryUncertainInput = LeaseIdentity & {
  now: Date;
  error: OutboundErrorClassification;
};

export type ScheduleReconciliationInput = LeaseIdentity & {
  availableAt: Date;
  now: Date;
  outcome: 'not_found' | 'uncertain';
};

export type ScheduleResendInput = LeaseIdentity & {
  availableAt: Date;
  now: Date;
  outcome?: 'not_found' | 'uncertain';
  reason?: 'reconciliation_unsupported';
};

export type FailDeliveryInput = LeaseIdentity & {
  now: Date;
  error: OutboundErrorClassification;
};

export type CancelDeliveryInput = LeaseIdentity & {
  now: Date;
};

export type CompleteDeliveryInput = LeaseIdentity & {
  completedAt: Date;
  remoteMessageId: string;
  remoteThreadId: string | null;
  providerCode: string | null;
};

export interface MailOutboundRepository {
  insert(input: InsertOutboundDelivery): Promise<OutboundDeliveryRecord>;
  findById(deliveryId: string): Promise<OutboundDeliveryRecord | null>;
  findBySubmission(accountId: string, submissionId: string): Promise<OutboundDeliveryRecord | null>;
  listDue(input: { now: Date; limit: number }): Promise<string[]>;
  claimById(input: ClaimDeliveryInput): Promise<ClaimedDelivery | null>;
  recoverExpiredLeases(input: { now: Date; limit: number }): Promise<string[]>;
  loadMessage(input: LeaseIdentity): Promise<OutboundMessageSnapshot>;
  finishAttempt(input: FinishAttemptInput): Promise<void>;
  scheduleRetry(input: ScheduleDeliveryRetryInput): Promise<void>;
  markUncertain(input: MarkDeliveryUncertainInput): Promise<void>;
  scheduleReconciliation(input: ScheduleReconciliationInput): Promise<void>;
  scheduleResend(input: ScheduleResendInput): Promise<void>;
  markFailed(input: FailDeliveryInput): Promise<void>;
  markCanceled(input: CancelDeliveryInput): Promise<void>;
  markCompleted(input: CompleteDeliveryInput): Promise<void>;
}

export type MailOutboundRepositoryFactories = {
  nextId(): string;
  nextLeaseToken(): string;
};

const mapDelivery = (row: typeof outboundDelivery.$inferSelect): OutboundDeliveryRecord => ({
  ...row,
});

const storageFailure = (entityId?: string, cause?: unknown): never => {
  throw new MailOutboundError(
    'MAIL_OUTBOUND_STORAGE_FAILURE',
    'transient',
    entityId,
    cause === undefined ? undefined : { cause },
  );
};

const leaseLost = (deliveryId: string): never => {
  throw new MailOutboundError('MAIL_OUTBOUND_LEASE_LOST', 'transient', deliveryId);
};

const runOutboundAdapter = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MailOutboundError) {
      throw error;
    }
    return storageFailure(undefined, error);
  }
};

const requirePositiveLimit = (limit: number): void => {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    storageFailure();
  }
};

const requireLeaseDuration = (leaseForMs: number): void => {
  if (!Number.isSafeInteger(leaseForMs) || leaseForMs <= 0) {
    storageFailure();
  }
};

const leasedWhere = (input: LeaseIdentity) =>
  and(
    eq(outboundDelivery.id, input.deliveryId),
    eq(outboundDelivery.status, 'leased'),
    eq(outboundDelivery.leaseToken, input.leaseToken),
  );

const finishAttemptRows = async (db: MailDatabase, input: FinishAttemptInput): Promise<void> => {
  const rows = await db
    .update(sendAttempt)
    .set({
      finishedAt: input.finishedAt,
      outcome: input.outcome,
      providerCode: input.providerCode ?? null,
      safeResponse: input.safeResponse ?? null,
      retryAt: input.retryAt ?? null,
      remoteMessageId: input.remoteMessageId ?? null,
      remoteThreadId: input.remoteThreadId ?? null,
    })
    .where(
      and(
        eq(sendAttempt.deliveryId, input.deliveryId),
        eq(sendAttempt.leaseToken, input.leaseToken),
        isNull(sendAttempt.finishedAt),
      ),
    )
    .returning({ id: sendAttempt.id });
  if (rows.length !== 1) {
    leaseLost(input.deliveryId);
  }
};

const transitionLeased = async (
  db: MailDatabase,
  input: LeaseIdentity,
  patch: PgUpdateSetSource<typeof outboundDelivery>,
): Promise<OutboundDeliveryRecord> => {
  const rows = await db.update(outboundDelivery).set(patch).where(leasedWhere(input)).returning();
  const row = rows[0];
  if (row === undefined) {
    return leaseLost(input.deliveryId);
  }
  return mapDelivery(row);
};

const clearLease = {
  leaseOwner: null,
  leaseToken: null,
  leaseExpiresAt: null,
} as const;

const dueStatuses: OutboundDeliveryStatus[] = ['scheduled', 'ready', 'retry_wait', 'uncertain'];

export const createMailOutboundRepository = (
  db: MailDatabase,
  factories: MailOutboundRepositoryFactories,
): MailOutboundRepository => ({
  insert: (input) =>
    runOutboundAdapter(async () => {
      const rows = await db
        .insert(outboundDelivery)
        .values({
          id: input.id,
          mailAccountId: input.mailAccountId,
          submissionId: input.submissionId,
          connectionId: input.connectionId,
          status: input.status,
          availableAt: input.availableAt,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing({
          target: [outboundDelivery.mailAccountId, outboundDelivery.submissionId],
        })
        .returning();
      if (rows[0] !== undefined) {
        return mapDelivery(rows[0]);
      }
      const existing = await db
        .select()
        .from(outboundDelivery)
        .where(
          and(
            eq(outboundDelivery.mailAccountId, input.mailAccountId),
            eq(outboundDelivery.submissionId, input.submissionId),
          ),
        )
        .limit(1);
      return existing[0] === undefined ? storageFailure(input.id) : mapDelivery(existing[0]);
    }),
  findById: (deliveryId) =>
    runOutboundAdapter(async () => {
      const rows = await db
        .select()
        .from(outboundDelivery)
        .where(eq(outboundDelivery.id, deliveryId))
        .limit(1);
      return rows[0] === undefined ? null : mapDelivery(rows[0]);
    }),
  findBySubmission: (accountId, submissionId) =>
    runOutboundAdapter(async () => {
      const rows = await db
        .select()
        .from(outboundDelivery)
        .where(
          and(
            eq(outboundDelivery.mailAccountId, accountId),
            eq(outboundDelivery.submissionId, submissionId),
          ),
        )
        .limit(1);
      return rows[0] === undefined ? null : mapDelivery(rows[0]);
    }),
  listDue: ({ now, limit }) =>
    runOutboundAdapter(async () => {
      requirePositiveLimit(limit);
      return (
        await db
          .select({ id: outboundDelivery.id })
          .from(outboundDelivery)
          .where(
            and(
              inArray(outboundDelivery.status, dueStatuses),
              lte(outboundDelivery.availableAt, now),
            ),
          )
          .orderBy(asc(outboundDelivery.availableAt), asc(outboundDelivery.id))
          .limit(limit)
      ).map(({ id }) => id);
    }),
  claimById: (input) =>
    runOutboundAdapter(async () => {
      requireLeaseDuration(input.leaseForMs);
      const leaseToken = factories.nextLeaseToken();
      const allowed =
        input.attemptKind === 'send'
          ? (['scheduled', 'ready', 'retry_wait'] as const)
          : (['uncertain'] as const);
      const counterPatch =
        input.attemptKind === 'send'
          ? {
              attemptCount: sql`${outboundDelivery.attemptCount} + 1`,
            }
          : {
              reconciliationCount: sql`${outboundDelivery.reconciliationCount} + 1`,
            };
      const rows = await db
        .update(outboundDelivery)
        .set({
          status: 'leased',
          leaseOwner: input.owner,
          leaseToken,
          leaseExpiresAt: new Date(input.now.getTime() + input.leaseForMs),
          updatedAt: input.now,
          ...counterPatch,
        })
        .where(
          and(
            eq(outboundDelivery.id, input.deliveryId),
            inArray(outboundDelivery.status, allowed),
            lte(outboundDelivery.availableAt, input.now),
          ),
        )
        .returning();
      const row = rows[0];
      if (row === undefined) {
        return null;
      }
      const attemptNumber = row.attemptCount + row.reconciliationCount;
      await db.insert(sendAttempt).values({
        id: factories.nextId(),
        mailAccountId: row.mailAccountId,
        deliveryId: row.id,
        submissionId: row.submissionId,
        attemptNumber,
        kind: input.attemptKind,
        leaseToken,
        startedAt: input.now,
      });
      return {
        delivery: mapDelivery(row) as ClaimedDelivery['delivery'],
        attemptKind: input.attemptKind,
        attemptNumber,
      };
    }),
  recoverExpiredLeases: ({ now, limit }) =>
    runOutboundAdapter(async () => {
      requirePositiveLimit(limit);
      const expired = await db
        .select({
          id: outboundDelivery.id,
          leaseToken: outboundDelivery.leaseToken,
        })
        .from(outboundDelivery)
        .where(
          and(eq(outboundDelivery.status, 'leased'), lte(outboundDelivery.leaseExpiresAt, now)),
        )
        .orderBy(asc(outboundDelivery.leaseExpiresAt), asc(outboundDelivery.id))
        .limit(limit)
        .for('update', { skipLocked: true });
      const recovered: string[] = [];
      for (const row of expired) {
        const leaseToken = row.leaseToken ?? storageFailure(row.id);
        await finishAttemptRows(db, {
          deliveryId: row.id,
          leaseToken,
          finishedAt: now,
          outcome: 'uncertain',
          safeResponse: 'unknown_result',
        });
        const rows = await db
          .update(outboundDelivery)
          .set({
            status: 'uncertain',
            availableAt: now,
            uncertainSince: sql`coalesce(
              ${outboundDelivery.uncertainSince},
              ${sql.param(now, outboundDelivery.uncertainSince)}
            )`,
            updatedAt: now,
            lastErrorKind: 'uncertain',
            lastErrorMessage: 'unknown_result',
            ...clearLease,
          })
          .where(
            and(
              eq(outboundDelivery.id, row.id),
              eq(outboundDelivery.status, 'leased'),
              eq(outboundDelivery.leaseToken, leaseToken),
            ),
          )
          .returning({ id: outboundDelivery.id });
        if (rows.length !== 1) {
          leaseLost(row.id);
        }
        recovered.push(row.id);
      }
      return recovered;
    }),
  loadMessage: (input) =>
    runOutboundAdapter(async () => {
      const deliveries = await db
        .select()
        .from(outboundDelivery)
        .where(leasedWhere(input))
        .limit(1);
      const delivery = deliveries[0];
      if (delivery === undefined) {
        return leaseLost(input.deliveryId);
      }
      const submissions = await db
        .select()
        .from(emailSubmission)
        .where(
          and(
            eq(emailSubmission.id, delivery.submissionId),
            eq(emailSubmission.mailAccountId, delivery.mailAccountId),
          ),
        )
        .limit(1);
      const submission = submissions[0];
      if (submission === undefined) {
        return storageFailure(delivery.id);
      }
      const [emails, rawRows, addressRows, connectionRows] = await Promise.all([
        db
          .select()
          .from(email)
          .where(
            and(eq(email.id, submission.emailId), eq(email.mailAccountId, delivery.mailAccountId)),
          )
          .limit(1),
        db
          .select()
          .from(submissionBlob)
          .where(
            and(
              eq(submissionBlob.mailAccountId, delivery.mailAccountId),
              eq(submissionBlob.submissionId, submission.id),
              eq(submissionBlob.kind, 'raw'),
              eq(submissionBlob.position, 0),
            ),
          )
          .limit(1),
        db
          .select()
          .from(emailAddress)
          .where(
            and(
              eq(emailAddress.mailAccountId, delivery.mailAccountId),
              eq(emailAddress.emailId, submission.emailId),
            ),
          )
          .orderBy(asc(emailAddress.kind), asc(emailAddress.position)),
        db
          .select({ channelId: connection.channelId })
          .from(connection)
          .where(eq(connection.id, delivery.connectionId))
          .limit(1),
      ]);
      const message = emails[0];
      const raw = rawRows[0];
      const channel = connectionRows[0];
      if (
        message === undefined ||
        raw === undefined ||
        channel === undefined ||
        message.messageIdHeader === null
      ) {
        return storageFailure(delivery.id);
      }
      const from =
        addressRows.find(({ kind }) => kind === 'sender') ??
        addressRows.find(({ kind }) => kind === 'from');
      if (from === undefined) {
        return storageFailure(delivery.id);
      }
      const replyRows =
        message.replyToEmailId === null
          ? []
          : await db
              .select({
                provider: remoteEmail.provider,
                remoteThreadId: remoteEmail.remoteThreadId,
              })
              .from(remoteEmail)
              .where(
                and(
                  eq(remoteEmail.mailAccountId, delivery.mailAccountId),
                  eq(remoteEmail.emailId, message.replyToEmailId),
                ),
              )
              .orderBy(asc(remoteEmail.provider));
      const addresses = (kind: 'to' | 'cc' | 'bcc') =>
        addressRows
          .filter((row) => row.kind === kind)
          .sort((left, right) => left.position - right.position)
          .map(({ address }) => address);
      return {
        delivery: mapDelivery(delivery),
        channelId: channel.channelId,
        envelope: {
          from: from.address,
          to: addresses('to'),
          cc: addresses('cc'),
          bcc: addresses('bcc'),
        },
        messageId: message.messageIdHeader,
        raw: {
          blobId: raw.blobId,
          objectKey: raw.objectKey,
          sha256: raw.sha256,
          sizeBytes: raw.sizeBytes,
          contentType: raw.contentType,
        },
        remoteThreadReferences: replyRows.flatMap((row) =>
          row.remoteThreadId === null
            ? []
            : [{ provider: row.provider, remoteThreadId: row.remoteThreadId }],
        ),
      };
    }),
  finishAttempt: (input) =>
    runOutboundAdapter(async () => {
      const deliveries = await db
        .select({ id: outboundDelivery.id })
        .from(outboundDelivery)
        .where(leasedWhere(input))
        .limit(1);
      if (deliveries.length !== 1) {
        leaseLost(input.deliveryId);
      }
      await finishAttemptRows(db, input);
    }),
  scheduleRetry: (input) =>
    runOutboundAdapter(async () => {
      await transitionLeased(db, input, {
        status: 'retry_wait',
        availableAt: input.retryAt,
        updatedAt: input.now,
        lastErrorKind: input.error.kind,
        lastErrorCode: input.error.providerCode,
        lastErrorMessage: input.error.safeResponse,
        ...clearLease,
      });
      await finishAttemptRows(db, {
        ...input,
        finishedAt: input.now,
        outcome: 'transient_failure',
        providerCode: input.error.providerCode,
        safeResponse: input.error.safeResponse,
        retryAt: input.retryAt,
      });
    }),
  markUncertain: (input) =>
    runOutboundAdapter(async () => {
      await transitionLeased(db, input, {
        status: 'uncertain',
        availableAt: input.now,
        uncertainSince: sql`coalesce(
          ${outboundDelivery.uncertainSince},
          ${sql.param(input.now, outboundDelivery.uncertainSince)}
        )`,
        updatedAt: input.now,
        lastErrorKind: 'uncertain',
        lastErrorCode: input.error.providerCode,
        lastErrorMessage: input.error.safeResponse,
        ...clearLease,
      });
      await finishAttemptRows(db, {
        ...input,
        finishedAt: input.now,
        outcome: 'uncertain',
        providerCode: input.error.providerCode,
        safeResponse: input.error.safeResponse,
      });
    }),
  scheduleReconciliation: (input) =>
    runOutboundAdapter(async () => {
      await transitionLeased(db, input, {
        status: 'uncertain',
        availableAt: input.availableAt,
        uncertainSince: sql`coalesce(
          ${outboundDelivery.uncertainSince},
          ${sql.param(input.now, outboundDelivery.uncertainSince)}
        )`,
        updatedAt: input.now,
        ...clearLease,
      });
      await finishAttemptRows(db, {
        ...input,
        finishedAt: input.now,
        outcome: input.outcome,
        retryAt: input.availableAt,
      });
    }),
  scheduleResend: (input) =>
    runOutboundAdapter(async () => {
      await transitionLeased(db, input, {
        status: 'ready',
        availableAt: input.availableAt,
        updatedAt: input.now,
        ...(input.reason === undefined
          ? {}
          : {
              lastErrorKind: 'uncertain' as const,
              lastErrorMessage: input.reason,
            }),
        ...clearLease,
      });
      await finishAttemptRows(db, {
        ...input,
        finishedAt: input.now,
        outcome: input.outcome ?? 'not_found',
      });
    }),
  markFailed: (input) =>
    runOutboundAdapter(async () => {
      await transitionLeased(db, input, {
        status: 'failed',
        updatedAt: input.now,
        lastErrorKind: input.error.kind,
        lastErrorCode: input.error.providerCode,
        lastErrorMessage: input.error.safeResponse,
        ...clearLease,
      });
      await finishAttemptRows(db, {
        ...input,
        finishedAt: input.now,
        outcome: 'permanent_failure',
        providerCode: input.error.providerCode,
        safeResponse: input.error.safeResponse,
      });
    }),
  markCanceled: (input) =>
    runOutboundAdapter(async () => {
      await transitionLeased(db, input, {
        status: 'canceled',
        updatedAt: input.now,
        ...clearLease,
      });
      await finishAttemptRows(db, {
        ...input,
        finishedAt: input.now,
        outcome: 'permanent_failure',
      });
    }),
  markCompleted: (input) =>
    runOutboundAdapter(async () => {
      await transitionLeased(db, input, {
        status: 'completed',
        updatedAt: input.completedAt,
        completedAt: input.completedAt,
        lastErrorKind: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        ...clearLease,
      });
      await finishAttemptRows(db, {
        ...input,
        finishedAt: input.completedAt,
        outcome: 'sent',
        providerCode: input.providerCode,
        safeResponse: 'accepted',
        remoteMessageId: input.remoteMessageId,
        remoteThreadId: input.remoteThreadId,
      });
    }),
});
