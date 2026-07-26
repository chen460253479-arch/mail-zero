import {
  MailCoreError,
  type EmailId,
  type EmailSubmissionId,
  type IdentityId,
  type MailAccountId,
  type MailCore,
  type SubmissionRecord,
} from '@zero/mail-core';
import type { MailOutboundRuntime } from '../../mail-outbound';
import type { z } from 'zod';

import {
  submissionChangesInputSchema,
  submissionGetInputSchema,
  submissionQueryInputSchema,
  submissionSchema,
  submissionSetInputSchema,
} from '../contracts/submission';
import { mapSetErrors } from './dto';

const toSubmissionDto = (submission: SubmissionRecord) => submissionSchema.parse(submission);

const missingSubmission = (error: unknown) =>
  error instanceof MailCoreError &&
  ['EMAIL_SUBMISSION_NOT_FOUND', 'CROSS_ACCOUNT_REFERENCE'].includes(error.code);

export const createSubmissionService = (
  core: Pick<MailCore, 'getChanges' | 'getState' | 'getSubmission' | 'querySubmissions'>,
  outbound: Pick<MailOutboundRuntime, 'set'>,
) => ({
  async get(input: z.infer<typeof submissionGetInputSchema>) {
    const accountId = input.accountId as MailAccountId;
    const state = await core.getState({ accountId, collection: 'email_submission' });
    const settled = await Promise.allSettled(
      input.ids.map((id) =>
        core.getSubmission({
          accountId,
          submissionId: id as EmailSubmissionId,
        }),
      ),
    );
    for (const result of settled) {
      if (result.status === 'rejected' && !missingSubmission(result.reason)) throw result.reason;
    }
    return {
      accountId: input.accountId,
      state,
      list: settled.flatMap((result) =>
        result.status === 'fulfilled' ? [toSubmissionDto(result.value)] : [],
      ),
      notFound: input.ids.filter((_, index) => settled[index]?.status === 'rejected'),
    };
  },

  async query(input: z.infer<typeof submissionQueryInputSchema>) {
    const accountId = input.accountId as MailAccountId;
    const state = await core.getState({ accountId, collection: 'email_submission' });
    const result = await core.querySubmissions({
      accountId,
      status: input.status,
      cursor: input.cursor ?? null,
      limit: input.limit,
    });
    return {
      accountId: input.accountId,
      state,
      list: result.submissions.map(toSubmissionDto),
      cursor: result.nextCursor,
    };
  },

  async set(input: z.infer<typeof submissionSetInputSchema>) {
    const accountId = input.accountId as MailAccountId;
    const result = await outbound.set({
      accountId,
      ifInState: input.ifInState,
      create: Object.fromEntries(
        Object.entries(input.create).map(([creationId, submission]) => [
          creationId,
          {
            emailId: submission.emailId as EmailId,
            identityId: submission.identityId as IdentityId,
            idempotencyKey: submission.idempotencyKey,
            sendAt: submission.sendAt == null ? null : new Date(submission.sendAt),
          },
        ]),
      ),
      destroy: input.destroy as EmailSubmissionId[],
    });
    return {
      accountId: input.accountId,
      ...result,
      created: Object.fromEntries(
        Object.entries(result.created).map(([id, submission]) => [id, toSubmissionDto(submission)]),
      ),
      notCreated: mapSetErrors(result.notCreated),
      notDestroyed: mapSetErrors(result.notDestroyed),
    };
  },

  changes(input: z.infer<typeof submissionChangesInputSchema>) {
    return core.getChanges({
      ...input,
      accountId: input.accountId as MailAccountId,
      collection: 'email_submission',
    });
  },
});
