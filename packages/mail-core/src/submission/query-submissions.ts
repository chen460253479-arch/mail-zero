import { z } from 'zod';

import { MailCoreError, type EmailSubmissionId, type MailAccountId } from '../types';
import type { MailCoreDependencies, SubmissionRecord } from '../store';
import { decodeSignedCursor, encodeSignedCursor } from '../search';
import type { SubmissionStatus } from './types';

const MAX_PAGE_SIZE = 200;

const safeId = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const isoDate = z.string().refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
});
const cursorSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('email_submission'),
    accountId: safeId,
    status: z.enum(['scheduled', 'queued', 'sent', 'failed', 'canceled']).nullable(),
    createdAt: isoDate,
    submissionId: safeId,
  })
  .strict();

type SubmissionCursor = z.infer<typeof cursorSchema>;

export type GetSubmissionInput = {
  accountId: MailAccountId;
  submissionId: EmailSubmissionId;
};

export type QuerySubmissionsInput = {
  accountId: MailAccountId;
  status?: SubmissionStatus;
  limit: number;
  cursor: string | null;
};

export type QuerySubmissionsResult = {
  submissions: SubmissionRecord[];
  nextCursor: string | null;
};

const invalidCursor = (): never => {
  throw new MailCoreError('INVALID_CURSOR');
};

const encodeCursor = (payload: SubmissionCursor, signingKey: string): string =>
  encodeSignedCursor(payload, signingKey);

const decodeCursor = (
  encoded: string,
  accountId: MailAccountId,
  status: SubmissionStatus | undefined,
  signingKey: string,
): SubmissionCursor => {
  try {
    const parsed = cursorSchema.safeParse(decodeSignedCursor(encoded, signingKey));
    if (!parsed.success) {
      return invalidCursor();
    }
    if (parsed.data.accountId !== accountId) {
      throw new MailCoreError('CROSS_ACCOUNT_REFERENCE');
    }
    if (parsed.data.status !== (status ?? null)) {
      return invalidCursor();
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof MailCoreError) {
      throw error;
    }
    return invalidCursor();
  }
};

export async function getSubmission(
  dependencies: Pick<MailCoreDependencies, 'unitOfWork'>,
  input: GetSubmissionInput,
): Promise<SubmissionRecord> {
  return dependencies.unitOfWork.run(async (tx) => {
    if ((await tx.accounts.findById(input.accountId)) === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    const record = await tx.submissions.findById(input.accountId, input.submissionId);
    if (record === null) {
      if (await tx.submissions.existsOutsideAccount(input.accountId, input.submissionId)) {
        throw new MailCoreError('CROSS_ACCOUNT_REFERENCE', { entityId: input.submissionId });
      }
      throw new MailCoreError('EMAIL_SUBMISSION_NOT_FOUND', { entityId: input.submissionId });
    }
    return record;
  });
}

export async function querySubmissions(
  dependencies: Pick<MailCoreDependencies, 'cursorSigningKey' | 'unitOfWork'>,
  input: QuerySubmissionsInput,
): Promise<QuerySubmissionsResult> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_PAGE_SIZE) {
    throw new MailCoreError('INVALID_QUERY');
  }
  const cursor =
    input.cursor === null
      ? null
      : decodeCursor(input.cursor, input.accountId, input.status, dependencies.cursorSigningKey);

  return dependencies.unitOfWork.run(async (tx) => {
    if ((await tx.accounts.findById(input.accountId)) === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    const records = await tx.submissions.queryPage({
      accountId: input.accountId,
      status: input.status,
      after:
        cursor === null
          ? null
          : {
              createdAt: new Date(cursor.createdAt),
              submissionId: cursor.submissionId as EmailSubmissionId,
            },
      limit: input.limit + 1,
    });
    const page = records.slice(0, input.limit);
    const last = page.at(-1);
    return {
      submissions: page,
      nextCursor:
        records.length > input.limit && last !== undefined
          ? encodeCursor(
              {
                version: 1,
                kind: 'email_submission',
                accountId: input.accountId,
                status: input.status ?? null,
                createdAt: last.createdAt.toISOString(),
                submissionId: last.id,
              },
              dependencies.cursorSigningKey,
            )
          : null,
    };
  });
}
