export const mailCoreErrorCodes = [
  'INVALID_KEYWORD',
  'INVALID_PATCH',
  'INVALID_GC_REQUEST',
  'INVALID_BLOB_KEY',
  'INVALID_CURSOR',
  'INVALID_QUERY',
  'INVALID_STATE',
  'STATE_MISMATCH',
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_NOT_ACTIVE',
  'MAILBOX_NOT_FOUND',
  'EMAIL_NOT_FOUND',
  'THREAD_NOT_FOUND',
  'BLOB_NOT_FOUND',
  'IDENTITY_NOT_FOUND',
  'IDENTITY_DEFAULT_CONFLICT',
  'EMAIL_SUBMISSION_NOT_FOUND',
  'MAILBOX_ROLE_CONFLICT',
  'MAILBOX_NAME_CONFLICT',
  'CROSS_ACCOUNT_REFERENCE',
  'MAILBOX_HAS_CHILD',
  'MAILBOX_HAS_EMAIL',
  'MAILBOX_PARENT_CYCLE',
  'EMAIL_MUST_HAVE_MAILBOX',
  'BLOB_INTEGRITY',
  'BLOB_STORE_FAILURE',
  'STORAGE_FAILURE',
  'MIME_PARSE_FAILED',
  'IDEMPOTENCY_CONFLICT',
  'SUBMISSION_ALREADY_PENDING',
  'DRAFT_REVISION_CONFLICT',
  'EMAIL_CONTENT_IMMUTABLE',
  'OVER_QUOTA',
  'INVALID_EMAIL',
  'IDENTITY_IN_USE',
  'INVALID_SUBMISSION_TRANSITION',
] as const;

export type MailCoreErrorCode = (typeof mailCoreErrorCodes)[number];

export interface MailCoreErrorDetails {
  readonly entityId?: string;
}

type MailCoreErrorDetailsInput = Readonly<Record<string, unknown>>;

function sanitizeDetails(details: MailCoreErrorDetailsInput): MailCoreErrorDetails {
  return typeof details.entityId === 'string' ? { entityId: details.entityId } : {};
}

export class MailCoreError extends Error {
  readonly code: MailCoreErrorCode;
  readonly details: MailCoreErrorDetails;

  constructor(code: MailCoreErrorCode, details: MailCoreErrorDetailsInput = {}) {
    super(code);
    this.name = 'MailCoreError';
    this.code = code;
    this.details = sanitizeDetails(details);
  }

  toJSON() {
    return {
      code: this.code,
      details: this.details,
    };
  }
}
