import type { SubmissionRecord, SubmissionRepository } from '@zero/mail-core';
import { and, asc, desc, eq, gt, inArray, ne, or } from 'drizzle-orm';

import { requireRow, runAdapter, type MailDatabase } from './database';
import { emailSubmission } from '../schema';

const mapSubmission = (row: typeof emailSubmission.$inferSelect): SubmissionRecord => ({
  id: row.id as SubmissionRecord['id'],
  accountId: row.mailAccountId as SubmissionRecord['accountId'],
  emailId: row.emailId as SubmissionRecord['emailId'],
  identityId: row.identityId as SubmissionRecord['identityId'],
  status: row.status,
  sendAt: row.sendAt,
  idempotencyKey: row.idempotencyKey,
  draftRevision: row.draftRevision,
  rawBlobId: row.rawBlobId as SubmissionRecord['rawBlobId'],
  rawSha256: row.rawSha256,
  rawSizeBytes: row.rawSizeBytes,
  rawObjectKey: row.rawObjectKey,
  providerMessageId: row.providerMessageId,
  lastErrorCode: row.lastErrorCode,
  lastErrorMessage: row.lastErrorMessage,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  sentAt: row.sentAt,
});

const hydrateSubmission = (row: typeof emailSubmission.$inferSelect): SubmissionRecord =>
  mapSubmission(row);

export const createSubmissionRepository = (db: MailDatabase): SubmissionRepository => ({
  findById: (accountId, id) =>
    runAdapter(async () => {
      const rows = await db
        .select()
        .from(emailSubmission)
        .where(and(eq(emailSubmission.mailAccountId, accountId), eq(emailSubmission.id, id)))
        .limit(1);
      return rows[0] === undefined ? null : hydrateSubmission(rows[0]);
    }),
  existsOutsideAccount: (accountId, id) =>
    runAdapter(async () => {
      const rows = await db
        .select({ id: emailSubmission.id })
        .from(emailSubmission)
        .where(and(eq(emailSubmission.id, id), ne(emailSubmission.mailAccountId, accountId)))
        .limit(1);
      return rows.length > 0;
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
      return rows[0] === undefined ? null : hydrateSubmission(rows[0]);
    }),
  findPendingByEmail: (accountId, emailId) =>
    runAdapter(async () => {
      const rows = await db
        .select()
        .from(emailSubmission)
        .where(
          and(
            eq(emailSubmission.mailAccountId, accountId),
            eq(emailSubmission.emailId, emailId),
            inArray(emailSubmission.status, ['queued', 'scheduled']),
          ),
        )
        .orderBy(desc(emailSubmission.createdAt), desc(emailSubmission.id))
        .limit(1);
      return rows[0] === undefined ? null : hydrateSubmission(rows[0]);
    }),
  listByIdentity: (accountId, identityId) =>
    runAdapter(async () =>
      Promise.all(
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
        ).map((row) => hydrateSubmission(row)),
      ),
    ),
  listByAccount: (accountId) =>
    runAdapter(async () =>
      Promise.all(
        (
          await db
            .select()
            .from(emailSubmission)
            .where(eq(emailSubmission.mailAccountId, accountId))
            .orderBy(asc(emailSubmission.createdAt), asc(emailSubmission.id))
        ).map((row) => hydrateSubmission(row)),
      ),
    ),
  queryPage: (input) =>
    runAdapter(async () => {
      const after =
        input.after === null
          ? undefined
          : or(
              gt(emailSubmission.createdAt, input.after.createdAt),
              and(
                eq(emailSubmission.createdAt, input.after.createdAt),
                gt(emailSubmission.id, input.after.submissionId),
              ),
            );
      return Promise.all(
        (
          await db
            .select()
            .from(emailSubmission)
            .where(
              and(
                eq(emailSubmission.mailAccountId, input.accountId),
                input.status === undefined ? undefined : eq(emailSubmission.status, input.status),
                after,
              ),
            )
            .orderBy(asc(emailSubmission.createdAt), asc(emailSubmission.id))
            .limit(input.limit)
        ).map((row) => hydrateSubmission(row)),
      );
    }),
  insert: (record) =>
    runAdapter(async () => {
      const { accountId, ...submission } = record;
      const rows = await db
        .insert(emailSubmission)
        .values({ ...submission, mailAccountId: accountId })
        .returning();
      const row = requireRow(rows, 'STORAGE_FAILURE');
      return hydrateSubmission(row);
    }),
  update: (accountId, id, patch) =>
    runAdapter(async () => {
      const rows = await db
        .update(emailSubmission)
        .set(patch)
        .where(and(eq(emailSubmission.mailAccountId, accountId), eq(emailSubmission.id, id)))
        .returning();
      return hydrateSubmission(requireRow(rows, 'EMAIL_SUBMISSION_NOT_FOUND', id));
    }),
});
