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
import { MailOutboundError } from '../../mail-outbound';
import type { z } from 'zod';

import {
  submissionChangesInputSchema,
  submissionGetInputSchema,
  submissionQueryInputSchema,
  submissionSchema,
  submissionSetInputSchema,
} from '../contracts/submission';
import { mapSetError } from './dto';

const toSubmissionDto = (submission: SubmissionRecord) => submissionSchema.parse(submission);

const missingSubmission = (error: unknown) =>
  error instanceof MailCoreError &&
  ['EMAIL_SUBMISSION_NOT_FOUND', 'CROSS_ACCOUNT_REFERENCE'].includes(error.code);

const outboundAsCoreError = (error: MailOutboundError): MailCoreError => {
  if (error.code === 'DELIVERY_NOT_FOUND') {
    return new MailCoreError('EMAIL_SUBMISSION_NOT_FOUND', { entityId: error.entityId });
  }
  if (error.code === 'INVALID_DELIVERY_TRANSITION') {
    return new MailCoreError('INVALID_SUBMISSION_TRANSITION', {
      entityId: error.entityId,
    });
  }
  return new MailCoreError('STORAGE_FAILURE');
};

export const createSubmissionService = (
  core: Pick<MailCore, 'getChanges' | 'getState' | 'getSubmission' | 'querySubmissions'>,
  outbound: Pick<MailOutboundRuntime, 'submit' | 'cancel'>,
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
    const result = await core.querySubmissions({
      accountId,
      status: input.status,
      cursor: input.cursor ?? null,
      limit: input.limit,
    });
    return {
      accountId: input.accountId,
      state: await core.getState({ accountId, collection: 'email_submission' }),
      list: result.submissions.map(toSubmissionDto),
      cursor: result.nextCursor,
    };
  },

  async set(input: z.infer<typeof submissionSetInputSchema>) {
    const accountId = input.accountId as MailAccountId;
    const oldState = await core.getState({ accountId, collection: 'email_submission' });
    if (input.ifInState !== undefined && input.ifInState !== oldState) {
      throw new MailCoreError('STATE_MISMATCH');
    }
    const created: Record<string, ReturnType<typeof toSubmissionDto>> = {};
    const destroyed: EmailSubmissionId[] = [];
    const notCreated: Record<string, ReturnType<typeof mapSetError>> = {};
    const notDestroyed: Record<string, ReturnType<typeof mapSetError>> = {};
    for (const [creationId, submission] of Object.entries(input.create)) {
      try {
        const result = await outbound.submit({
          accountId,
          emailId: submission.emailId as EmailId,
          identityId: submission.identityId as IdentityId,
          idempotencyKey: submission.idempotencyKey,
          sendAt: submission.sendAt == null ? null : new Date(submission.sendAt),
        });
        created[creationId] = toSubmissionDto(result.submission);
      } catch (error) {
        if (!(error instanceof MailCoreError)) throw error;
        notCreated[creationId] = mapSetError(error);
      }
    }
    for (const rawId of input.destroy) {
      const submissionId = rawId as EmailSubmissionId;
      try {
        await outbound.cancel({ accountId, submissionId });
        destroyed.push(submissionId);
      } catch (error) {
        const mapped =
          error instanceof MailOutboundError
            ? outboundAsCoreError(error)
            : error instanceof MailCoreError
              ? error
              : null;
        if (mapped === null) throw error;
        notDestroyed[rawId] = mapSetError(mapped);
      }
    }
    return {
      accountId: input.accountId,
      oldState,
      newState: await core.getState({
        accountId,
        collection: 'email_submission',
      }),
      created,
      destroyed,
      notCreated,
      notDestroyed,
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
