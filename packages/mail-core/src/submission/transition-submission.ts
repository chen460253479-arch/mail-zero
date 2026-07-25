import { isDeepStrictEqual } from 'node:util';

import type {
  CancelSubmissionInput,
  SubmissionCompletionOutcome,
  SubmissionStatus,
  TransitionSubmissionInput,
} from './types';
import type { MailCoreDependencies, SubmissionAttemptRecord, SubmissionRecord } from '../store';
import { calculateRetryAt } from './retry-policy';
import { submissionSafeResponses } from './types';
import { MailCoreError } from '../types';

export const allowedSubmissionTransitions = {
  scheduled: ['queued', 'canceled'],
  queued: ['sending', 'canceled'],
  sending: ['sent', 'retry_wait', 'failed'],
  retry_wait: ['queued', 'canceled'],
  sent: [],
  failed: [],
  canceled: [],
} as const satisfies Record<SubmissionStatus, readonly SubmissionStatus[]>;

const invalidTransition = (entityId: string): never => {
  throw new MailCoreError('INVALID_SUBMISSION_TRANSITION', { entityId });
};

const stableProviderCode = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized !== undefined && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)
    ? normalized
    : null;
};

const safeProviderResponse = (value: string | null | undefined): string | null => {
  return value !== null &&
    value !== undefined &&
    (submissionSafeResponses as readonly string[]).includes(value)
    ? value
    : null;
};

const completionPatch = (
  submission: SubmissionRecord,
  to: 'sent' | 'retry_wait' | 'failed',
  outcome: SubmissionCompletionOutcome | null,
  now: Date,
): {
  submission: Partial<SubmissionRecord>;
  attempt: Partial<SubmissionAttemptRecord>;
} => {
  if (to === 'sent') {
    if (outcome?.type !== 'sent') {
      return invalidTransition(submission.id);
    }
    return {
      submission: {
        status: 'sent',
        nextAttemptAt: null,
        providerMessageId: stableProviderCode(outcome.providerMessageId),
        lastErrorCode: null,
        lastErrorMessage: null,
        sentAt: new Date(now),
        updatedAt: new Date(now),
      },
      attempt: {
        finishedAt: new Date(now),
        outcome: 'sent',
        providerCode: stableProviderCode(outcome.providerCode),
        safeResponse: safeProviderResponse(outcome.safeResponse),
        retryAt: null,
      },
    };
  }
  if (outcome?.type !== 'failure') {
    return invalidTransition(submission.id);
  }
  const retryAt = calculateRetryAt(now, submission.attemptCount);
  const exhausted = retryAt === null;
  if (
    (to === 'retry_wait' && (!outcome.retryable || exhausted)) ||
    (to === 'failed' && outcome.retryable && !exhausted)
  ) {
    return invalidTransition(submission.id);
  }
  const providerCode = stableProviderCode(outcome.providerCode);
  const safeResponse = safeProviderResponse(outcome.safeResponse);
  return {
    submission: {
      status: to,
      nextAttemptAt: to === 'retry_wait' ? retryAt : null,
      lastErrorCode: providerCode,
      lastErrorMessage: safeResponse,
      updatedAt: new Date(now),
    },
    attempt: {
      finishedAt: new Date(now),
      outcome: to === 'retry_wait' ? 'transient_failure' : 'permanent_failure',
      providerCode,
      safeResponse,
      retryAt: to === 'retry_wait' ? retryAt : null,
    },
  };
};

const submissionChangedProperties = (
  before: SubmissionRecord,
  patch: Partial<SubmissionRecord>,
): string[] => {
  const properties: (keyof SubmissionRecord)[] = [
    'status',
    'attemptCount',
    'nextAttemptAt',
    'providerMessageId',
    'lastErrorCode',
    'lastErrorMessage',
    'sentAt',
  ];
  return properties.filter(
    (property) => property in patch && !isDeepStrictEqual(before[property], patch[property]),
  );
};

export async function transitionSubmission(
  dependencies: MailCoreDependencies,
  input: TransitionSubmissionInput,
): Promise<SubmissionRecord> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const now = dependencies.clock.now();
    const submission = await tx.submissions.findById(input.accountId, input.submissionId);
    if (submission === null) {
      throw new MailCoreError('EMAIL_SUBMISSION_NOT_FOUND', {
        entityId: input.submissionId,
      });
    }
    const allowed = allowedSubmissionTransitions[submission.status];
    if (!(allowed as readonly SubmissionStatus[]).includes(input.to)) {
      return invalidTransition(submission.id);
    }
    if (input.outcome !== null && submission.status !== 'sending') {
      return invalidTransition(submission.id);
    }
    if (
      submission.status === 'scheduled' &&
      input.to === 'queued' &&
      submission.sendAt.getTime() > now.getTime()
    ) {
      return invalidTransition(submission.id);
    }
    if (
      submission.status === 'retry_wait' &&
      input.to === 'queued' &&
      (submission.nextAttemptAt === null || submission.nextAttemptAt.getTime() > now.getTime())
    ) {
      return invalidTransition(submission.id);
    }

    let patch: Partial<SubmissionRecord>;
    if (submission.status === 'queued' && input.to === 'sending') {
      if (input.outcome !== null) {
        return invalidTransition(submission.id);
      }
      const attempts = await tx.submissions.listAttempts(input.accountId, submission.id);
      if (attempts.some(({ finishedAt }) => finishedAt === null)) {
        return invalidTransition(submission.id);
      }
      const attemptNumber = submission.attemptCount + 1;
      await tx.submissions.recordAttempt({
        id: dependencies.idFactory.next<'SubmissionAttempt'>(),
        accountId: input.accountId,
        submissionId: submission.id,
        attemptNumber,
        startedAt: new Date(now),
        finishedAt: null,
        outcome: null,
        providerCode: null,
        safeResponse: null,
        retryAt: null,
      });
      patch = {
        status: 'sending',
        attemptCount: attemptNumber,
        updatedAt: new Date(now),
      };
    } else if (submission.status === 'sending') {
      const attempts = await tx.submissions.listAttempts(input.accountId, submission.id);
      const open = attempts.filter(({ finishedAt }) => finishedAt === null);
      if (
        open.length !== 1 ||
        open[0]?.attemptNumber !== submission.attemptCount ||
        open[0].outcome !== null
      ) {
        return invalidTransition(submission.id);
      }
      const result = completionPatch(
        submission,
        input.to as 'sent' | 'retry_wait' | 'failed',
        input.outcome,
        now,
      );
      await tx.submissions.updateAttempt(
        input.accountId,
        submission.id,
        open[0].attemptNumber,
        result.attempt,
      );
      patch = result.submission;
    } else {
      if (input.outcome !== null) {
        return invalidTransition(submission.id);
      }
      patch = {
        status: input.to,
        ...(submission.status === 'retry_wait' ? { nextAttemptAt: null } : {}),
        updatedAt: new Date(now),
      };
    }

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
  });
}

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
