import { isDeepStrictEqual } from 'node:util';

import type { CancelSubmissionInput, SubmissionStatus, TransitionSubmissionInput } from './types';
import type { MailCoreDependencies, MailTransaction, SubmissionRecord } from '../store';
import { submissionSafeResponses } from './types';
import { MailCoreError } from '../types';

export const allowedSubmissionTransitions = {
  scheduled: ['queued', 'failed', 'canceled'],
  queued: ['sent', 'failed', 'canceled'],
  sent: [],
  failed: [],
  canceled: [],
} as const satisfies Record<SubmissionStatus, readonly SubmissionStatus[]>;

const invalidTransition = (entityId: string): never => {
  throw new MailCoreError('INVALID_SUBMISSION_TRANSITION', { entityId });
};

const stableProviderCode = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized !== undefined && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(normalized)
    ? normalized
    : null;
};

const safeProviderResponse = (value: string | null | undefined): string | null =>
  value !== null &&
  value !== undefined &&
  (submissionSafeResponses as readonly string[]).includes(value)
    ? value
    : null;

const completionPatch = (
  submission: SubmissionRecord,
  input: TransitionSubmissionInput,
  now: Date,
): Partial<SubmissionRecord> => {
  if (input.to === 'sent' && input.outcome?.type === 'sent') {
    return {
      status: 'sent',
      providerMessageId: stableProviderCode(input.outcome.providerMessageId),
      lastErrorCode: null,
      lastErrorMessage: null,
      sentAt: new Date(now),
      updatedAt: new Date(now),
    };
  }
  if (input.to === 'failed' && input.outcome?.type === 'failure' && !input.outcome.retryable) {
    return {
      status: 'failed',
      lastErrorCode: stableProviderCode(input.outcome.providerCode),
      lastErrorMessage: safeProviderResponse(input.outcome.safeResponse),
      updatedAt: new Date(now),
    };
  }
  return invalidTransition(submission.id);
};

const submissionChangedProperties = (
  before: SubmissionRecord,
  patch: Partial<SubmissionRecord>,
): string[] => {
  const properties: (keyof SubmissionRecord)[] = [
    'status',
    'providerMessageId',
    'lastErrorCode',
    'lastErrorMessage',
    'sentAt',
  ];
  return properties.filter(
    (property) => property in patch && !isDeepStrictEqual(before[property], patch[property]),
  );
};

export async function transitionSubmissionInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: TransitionSubmissionInput,
): Promise<SubmissionRecord> {
  await tx.lockAccount(input.accountId);
  const now = dependencies.clock.now();
  const submission = await tx.submissions.findById(input.accountId, input.submissionId);
  if (submission === null) {
    throw new MailCoreError('EMAIL_SUBMISSION_NOT_FOUND', {
      entityId: input.submissionId,
    });
  }
  if (
    !(allowedSubmissionTransitions[submission.status] as readonly SubmissionStatus[]).includes(
      input.to,
    )
  ) {
    return invalidTransition(submission.id);
  }
  if (
    submission.status === 'scheduled' &&
    input.to === 'queued' &&
    submission.sendAt.getTime() > now.getTime()
  ) {
    return invalidTransition(submission.id);
  }

  const patch =
    input.to === 'sent' || input.to === 'failed'
      ? completionPatch(submission, input, now)
      : input.outcome === null
        ? { status: input.to, updatedAt: new Date(now) }
        : invalidTransition(submission.id);
  const changedProperties = submissionChangedProperties(submission, patch);
  const updated = await tx.submissions.update(input.accountId, submission.id, patch);
  const stateVersion = await tx.nextStateVersion(input.accountId);
  await tx.changes.recordChange({
    accountId: input.accountId,
    stateVersion,
    collection: 'email_submission',
    entityId: submission.id,
    changeType: 'updated',
    changedProperties,
    createdAt: now,
  });
  return updated;
}

export const transitionSubmission = (
  dependencies: MailCoreDependencies,
  input: TransitionSubmissionInput,
): Promise<SubmissionRecord> =>
  dependencies.unitOfWork.run((tx) => transitionSubmissionInTransaction(dependencies, tx, input));

export async function cancelSubmission(
  dependencies: MailCoreDependencies,
  input: CancelSubmissionInput,
): Promise<SubmissionRecord> {
  return transitionSubmission(dependencies, {
    ...input,
    to: 'canceled',
    outcome: null,
  });
}
