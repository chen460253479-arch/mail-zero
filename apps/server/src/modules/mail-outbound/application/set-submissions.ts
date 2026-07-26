import {
  MailCoreError,
  assertState,
  type CreateSubmissionInput,
  type EmailSubmissionId,
  type MailAccountId,
  type MailCoreErrorCode,
  type MailCoreSetError,
  type SubmissionRecord,
} from '@zero/mail-core';

import {
  enqueueSubmissionInTransaction,
  type EnqueueSubmissionDependencies,
} from './enqueue-submission';
import { cancelPendingDeliveryInTransaction } from './cancel-delivery';
import { MailOutboundError } from '../domain/errors';

const itemErrorCodes = new Set<MailCoreErrorCode>([
  'EMAIL_NOT_FOUND',
  'IDENTITY_NOT_FOUND',
  'CROSS_ACCOUNT_REFERENCE',
  'BLOB_NOT_FOUND',
  'INVALID_EMAIL',
  'IDEMPOTENCY_CONFLICT',
  'INVALID_SUBMISSION_TRANSITION',
]);

const asCreateItemError = (error: unknown): MailCoreSetError | null => {
  if (error instanceof MailCoreError && itemErrorCodes.has(error.code)) {
    return { code: error.code, details: error.details };
  }
  return null;
};

const asDestroyItemError = (error: unknown): MailCoreSetError | null => {
  if (error instanceof MailOutboundError) {
    return {
      code:
        error.code === 'DELIVERY_NOT_FOUND'
          ? 'EMAIL_SUBMISSION_NOT_FOUND'
          : 'INVALID_SUBMISSION_TRANSITION',
      details: error.entityId === undefined ? {} : { entityId: error.entityId },
    };
  }
  return null;
};

export type SetOutboundSubmissionsInput = {
  accountId: MailAccountId;
  ifInState?: string;
  create: Record<string, Omit<CreateSubmissionInput, 'accountId'>>;
  destroy: EmailSubmissionId[];
};

export type SetOutboundSubmissionsResult = {
  oldState: string;
  newState: string;
  created: Record<string, SubmissionRecord>;
  destroyed: EmailSubmissionId[];
  notCreated: Record<string, MailCoreSetError>;
  notDestroyed: Record<string, MailCoreSetError>;
};

export async function setOutboundSubmissions(
  input: SetOutboundSubmissionsInput,
  dependencies: EnqueueSubmissionDependencies,
): Promise<SetOutboundSubmissionsResult> {
  const wakeups: string[] = [];
  const result = await dependencies.unitOfWork.run(async (tx) => {
    await tx.mail.lockAccount(input.accountId);
    const oldState = await assertState(tx.mail, input.accountId, input.ifInState);
    const created: Record<string, SubmissionRecord> = {};
    const destroyed: EmailSubmissionId[] = [];
    const notCreated: Record<string, MailCoreSetError> = {};
    const notDestroyed: Record<string, MailCoreSetError> = {};

    for (const [creationId, submission] of Object.entries(input.create)) {
      try {
        const queued = await enqueueSubmissionInTransaction(
          { accountId: input.accountId, ...submission },
          dependencies,
          tx,
        );
        created[creationId] = queued.submission;
        wakeups.push(queued.delivery.id);
      } catch (error) {
        const item = asCreateItemError(error);
        if (item === null) throw error;
        notCreated[creationId] = item;
      }
    }

    for (const submissionId of input.destroy) {
      try {
        await cancelPendingDeliveryInTransaction(
          { accountId: input.accountId, submissionId },
          dependencies,
          tx,
        );
        destroyed.push(submissionId);
      } catch (error) {
        const item = asDestroyItemError(error);
        if (item === null) throw error;
        notDestroyed[submissionId] = item;
      }
    }

    const account = await tx.mail.accounts.findById(input.accountId);
    if (account === null) throw new MailCoreError('ACCOUNT_NOT_FOUND');
    return {
      oldState,
      newState: account.stateVersion.toString(),
      created,
      destroyed,
      notCreated,
      notDestroyed,
    };
  });

  for (const deliveryId of wakeups) {
    try {
      await dependencies.wakeup.enqueue({ type: 'deliver', deliveryId });
    } catch (error) {
      dependencies.onWakeupError?.(error);
    }
  }
  return result;
}
