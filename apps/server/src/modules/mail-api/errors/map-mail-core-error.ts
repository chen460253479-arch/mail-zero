import { MailCoreError, type MailCoreErrorCode } from '@zero/mail-core';

import { MailApiError, type MailApiErrorCode } from './mail-api-error';

type Mapping = {
  code: MailApiErrorCode;
  retryable: boolean;
};

const storageFailure: Mapping = { code: 'STORAGE_FAILURE', retryable: true };
const invalidArguments: Mapping = { code: 'INVALID_ARGUMENTS', retryable: false };
const notFound: Mapping = { code: 'NOT_FOUND', retryable: false };

const mapping: Record<MailCoreErrorCode, Mapping> = {
  INVALID_KEYWORD: invalidArguments,
  INVALID_PATCH: invalidArguments,
  INVALID_GC_REQUEST: invalidArguments,
  INVALID_BLOB_KEY: invalidArguments,
  INVALID_CURSOR: { code: 'INVALID_CURSOR', retryable: false },
  INVALID_QUERY: invalidArguments,
  INVALID_STATE: invalidArguments,
  STATE_MISMATCH: { code: 'STATE_MISMATCH', retryable: false },
  ACCOUNT_NOT_FOUND: { code: 'ACCOUNT_NOT_FOUND', retryable: false },
  ACCOUNT_NOT_ACTIVE: { code: 'ACCOUNT_NOT_ACTIVE', retryable: false },
  MAILBOX_NOT_FOUND: notFound,
  EMAIL_NOT_FOUND: notFound,
  THREAD_NOT_FOUND: notFound,
  BLOB_NOT_FOUND: notFound,
  IDENTITY_NOT_FOUND: notFound,
  IDENTITY_DEFAULT_CONFLICT: invalidArguments,
  EMAIL_SUBMISSION_NOT_FOUND: notFound,
  MAILBOX_ROLE_CONFLICT: invalidArguments,
  MAILBOX_NAME_CONFLICT: invalidArguments,
  CROSS_ACCOUNT_REFERENCE: notFound,
  MAILBOX_HAS_CHILD: { code: 'MAILBOX_HAS_CHILD', retryable: false },
  MAILBOX_HAS_EMAIL: { code: 'MAILBOX_HAS_EMAIL', retryable: false },
  MAILBOX_PARENT_CYCLE: invalidArguments,
  EMAIL_MUST_HAVE_MAILBOX: invalidArguments,
  BLOB_INTEGRITY: storageFailure,
  BLOB_STORE_FAILURE: storageFailure,
  STORAGE_FAILURE: storageFailure,
  MIME_PARSE_FAILED: storageFailure,
  IDEMPOTENCY_CONFLICT: { code: 'STATE_MISMATCH', retryable: false },
  DRAFT_REVISION_CONFLICT: { code: 'REVISION_MISMATCH', retryable: false },
  EMAIL_CONTENT_IMMUTABLE: invalidArguments,
  OVER_QUOTA: { code: 'OVER_QUOTA', retryable: false },
  INVALID_EMAIL: invalidArguments,
  IDENTITY_IN_USE: invalidArguments,
  INVALID_SUBMISSION_TRANSITION: {
    code: 'SUBMISSION_NOT_CANCELABLE',
    retryable: false,
  },
};

export function mapMailCoreError(
  error: unknown,
  options: { requestId?: string } = {},
): MailApiError {
  const requestId = options.requestId ?? crypto.randomUUID();
  if (error instanceof MailApiError) return error;
  const mapped = error instanceof MailCoreError ? mapping[error.code] : storageFailure;
  return new MailApiError({ ...mapped, requestId });
}
