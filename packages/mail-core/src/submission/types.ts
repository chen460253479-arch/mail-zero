import type { EmailId, EmailSubmissionId, IdentityId, MailAccountId } from '../types';

export type SubmissionStatus =
  | 'scheduled'
  | 'queued'
  | 'sending'
  | 'retry_wait'
  | 'sent'
  | 'failed'
  | 'canceled';

export type SubmissionAttemptOutcome = 'sent' | 'transient_failure' | 'permanent_failure';

export const submissionSafeResponses = [
  'accepted',
  'rate_limited',
  'temporary_failure',
  'permanent_failure',
  'authentication_failed',
  'quota_exceeded',
  'invalid_recipient',
  'policy_rejected',
] as const;

export type SubmissionSafeResponse = (typeof submissionSafeResponses)[number];

export type CreateSubmissionInput = {
  accountId: MailAccountId;
  emailId: EmailId;
  identityId: IdentityId;
  idempotencyKey: string;
  sendAt: Date | null;
};

export type FinalizeSubmissionSentInput = {
  accountId: MailAccountId;
  submissionId: EmailSubmissionId;
  provider: string;
  remoteMessageId: string;
  remoteThreadId: string | null;
  acceptedAt: Date;
};

export type SentSubmissionOutcome = {
  type: 'sent';
  providerMessageId?: string | null;
  providerCode?: string | null;
  safeResponse?: SubmissionSafeResponse | null;
};

export type FailedSubmissionOutcome = {
  type: 'failure';
  retryable: boolean;
  providerCode?: string | null;
  safeResponse?: SubmissionSafeResponse | null;
};

export type SubmissionCompletionOutcome = SentSubmissionOutcome | FailedSubmissionOutcome;

export type TransitionSubmissionInput = {
  accountId: MailAccountId;
  submissionId: EmailSubmissionId;
  to: SubmissionStatus;
  outcome: SubmissionCompletionOutcome | null;
};

export type CancelSubmissionInput = {
  accountId: MailAccountId;
  submissionId: EmailSubmissionId;
};
