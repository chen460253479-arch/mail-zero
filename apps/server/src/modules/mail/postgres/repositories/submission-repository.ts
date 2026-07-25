import type {
  SubmissionAttemptRecord,
  SubmissionRecord,
  SubmissionRepository,
} from '@zero/mail-core';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { MailCoreError } from '@zero/mail-core';

import { requireRow, runAdapter, type MailDatabase } from './database';
import { emailSubmission, submissionAttempt } from '../schema';

const mapSubmission = (row: typeof emailSubmission.$inferSelect): SubmissionRecord => ({
  id: row.id as SubmissionRecord['id'],
  accountId: row.mailAccountId as SubmissionRecord['accountId'],
  emailId: row.emailId as SubmissionRecord['emailId'],
  identityId: row.identityId as SubmissionRecord['identityId'],
  status: row.status,
  sendAt: row.sendAt,
  idempotencyKey: row.idempotencyKey,
  draftRevision: row.draftRevision,
  attemptCount: row.attemptCount,
  nextAttemptAt: row.nextAttemptAt,
  providerMessageId: row.providerMessageId,
  lastErrorCode: row.lastErrorCode,
  lastErrorMessage: row.lastErrorMessage,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  sentAt: row.sentAt,
});

const mapAttempt = (row: typeof submissionAttempt.$inferSelect): SubmissionAttemptRecord => ({
  id: row.id,
  accountId: row.mailAccountId as SubmissionAttemptRecord['accountId'],
  submissionId: row.submissionId as SubmissionAttemptRecord['submissionId'],
  attemptNumber: row.attemptNumber,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
  outcome: row.outcome,
  providerCode: row.providerCode,
  safeResponse: row.safeResponse,
  retryAt: row.retryAt,
});

export const createSubmissionRepository = (db: MailDatabase): SubmissionRepository => ({
  findById: (accountId, id) =>
    runAdapter(async () => {
      const rows = await db
        .select()
        .from(emailSubmission)
        .where(and(eq(emailSubmission.mailAccountId, accountId), eq(emailSubmission.id, id)))
        .limit(1);
      return rows[0] === undefined ? null : mapSubmission(rows[0]);
    }),
  findByIdempotencyKey: (accountId, idempotencyKey) =>
    runAdapter(async () => {
      const rows = await db
        .select()
        .from(emailSubmission)
        .where(
          and(
            eq(emailSubmission.mailAccountId, accountId),
            eq(emailSubmission.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      return rows[0] === undefined ? null : mapSubmission(rows[0]);
    }),
  listByIdentity: (accountId, identityId) =>
    runAdapter(async () =>
      (
        await db
          .select()
          .from(emailSubmission)
          .where(
            and(
              eq(emailSubmission.mailAccountId, accountId),
              eq(emailSubmission.identityId, identityId),
            ),
          )
          .orderBy(asc(emailSubmission.createdAt), asc(emailSubmission.id))
      ).map(mapSubmission),
    ),
  insert: (record) =>
    runAdapter(async () => {
      const rows = await db
        .insert(emailSubmission)
        .values({ ...record, mailAccountId: record.accountId })
        .returning();
      return mapSubmission(requireRow(rows, 'STORAGE_FAILURE'));
    }),
  update: (accountId, id, patch) =>
    runAdapter(async () => {
      const rows = await db
        .update(emailSubmission)
        .set(patch)
        .where(and(eq(emailSubmission.mailAccountId, accountId), eq(emailSubmission.id, id)))
        .returning();
      return mapSubmission(requireRow(rows, 'EMAIL_SUBMISSION_NOT_FOUND', id));
    }),
  recordAttempt: (record) =>
    runAdapter(async () => {
      await db.insert(submissionAttempt).values({
        ...record,
        mailAccountId: record.accountId,
      });
    }),
  updateAttempt: (accountId, submissionId, attemptNumber, patch) =>
    runAdapter(async () => {
      const rows = await db
        .update(submissionAttempt)
        .set(patch)
        .where(
          and(
            eq(submissionAttempt.mailAccountId, accountId),
            eq(submissionAttempt.submissionId, submissionId),
            eq(submissionAttempt.attemptNumber, attemptNumber),
            isNull(submissionAttempt.finishedAt),
          ),
        )
        .returning();
      if (rows[0] === undefined) {
        throw new MailCoreError('INVALID_SUBMISSION_TRANSITION', {
          entityId: submissionId,
        });
      }
      return mapAttempt(rows[0]);
    }),
  listAttempts: (accountId, submissionId) =>
    runAdapter(async () =>
      (
        await db
          .select()
          .from(submissionAttempt)
          .where(
            and(
              eq(submissionAttempt.mailAccountId, accountId),
              eq(submissionAttempt.submissionId, submissionId),
            ),
          )
          .orderBy(asc(submissionAttempt.attemptNumber))
      ).map(mapAttempt),
    ),
});
