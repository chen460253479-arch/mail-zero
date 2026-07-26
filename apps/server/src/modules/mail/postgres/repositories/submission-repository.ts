import type {
  SubmissionBlobReference,
  SubmissionRecord,
  SubmissionRepository,
} from '@zero/mail-core';
import { and, asc, eq, gt, ne, or } from 'drizzle-orm';

import { requireRow, runAdapter, type MailDatabase } from './database';
import { emailSubmission, submissionBlob } from '../schema';

const mapSubmission = (
  row: typeof emailSubmission.$inferSelect,
  frozenBlobs: SubmissionBlobReference[],
): SubmissionRecord => ({
  id: row.id as SubmissionRecord['id'],
  accountId: row.mailAccountId as SubmissionRecord['accountId'],
  emailId: row.emailId as SubmissionRecord['emailId'],
  identityId: row.identityId as SubmissionRecord['identityId'],
  status: row.status,
  sendAt: row.sendAt,
  idempotencyKey: row.idempotencyKey,
  draftRevision: row.draftRevision,
  frozenBlobs,
  providerMessageId: row.providerMessageId,
  lastErrorCode: row.lastErrorCode,
  lastErrorMessage: row.lastErrorMessage,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  sentAt: row.sentAt,
});

const blobKindOrder = { raw: 0, text: 1, html: 2, part: 3 } as const;

const loadFrozenBlobs = async (
  db: MailDatabase,
  accountId: string,
  submissionId: string,
): Promise<SubmissionBlobReference[]> =>
  (
    await db
      .select()
      .from(submissionBlob)
      .where(
        and(
          eq(submissionBlob.mailAccountId, accountId),
          eq(submissionBlob.submissionId, submissionId),
        ),
      )
  )
    .map((row) => ({
      blobId: row.blobId as SubmissionBlobReference['blobId'],
      kind: row.kind,
      position: row.position,
      sha256: row.sha256,
      sizeBytes: row.sizeBytes,
      contentType: row.contentType,
      objectKey: row.objectKey,
    }))
    .sort(
      (left, right) =>
        blobKindOrder[left.kind] - blobKindOrder[right.kind] || left.position - right.position,
    );

const hydrateSubmission = async (
  db: MailDatabase,
  row: typeof emailSubmission.$inferSelect,
): Promise<SubmissionRecord> =>
  mapSubmission(row, await loadFrozenBlobs(db, row.mailAccountId, row.id));

export const createSubmissionRepository = (db: MailDatabase): SubmissionRepository => ({
  findById: (accountId, id) =>
    runAdapter(async () => {
      const rows = await db
        .select()
        .from(emailSubmission)
        .where(and(eq(emailSubmission.mailAccountId, accountId), eq(emailSubmission.id, id)))
        .limit(1);
      return rows[0] === undefined ? null : hydrateSubmission(db, rows[0]);
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
      return rows[0] === undefined ? null : hydrateSubmission(db, rows[0]);
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
        ).map((row) => hydrateSubmission(db, row)),
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
        ).map((row) => hydrateSubmission(db, row)),
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
        ).map((row) => hydrateSubmission(db, row)),
      );
    }),
  insert: (record) =>
    runAdapter(async () => {
      const { frozenBlobs, accountId, ...submission } = record;
      const rows = await db
        .insert(emailSubmission)
        .values({ ...submission, mailAccountId: accountId })
        .returning();
      const row = requireRow(rows, 'STORAGE_FAILURE');
      if (frozenBlobs.length > 0) {
        await db.insert(submissionBlob).values(
          frozenBlobs.map((frozen) => ({
            mailAccountId: accountId,
            submissionId: record.id,
            ...frozen,
          })),
        );
      }
      return hydrateSubmission(db, row);
    }),
  update: (accountId, id, patch) =>
    runAdapter(async () => {
      const rows = await db
        .update(emailSubmission)
        .set(patch)
        .where(and(eq(emailSubmission.mailAccountId, accountId), eq(emailSubmission.id, id)))
        .returning();
      return hydrateSubmission(db, requireRow(rows, 'EMAIL_SUBMISSION_NOT_FOUND', id));
    }),
});
