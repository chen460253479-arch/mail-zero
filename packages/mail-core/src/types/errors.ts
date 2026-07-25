export const mailCoreErrorCodes = [
  'INVALID_KEYWORD',
  'ACCOUNT_NOT_FOUND',
  'MAILBOX_NOT_FOUND',
  'EMAIL_NOT_FOUND',
  'THREAD_NOT_FOUND',
  'BLOB_NOT_FOUND',
  'IDENTITY_NOT_FOUND',
  'EMAIL_SUBMISSION_NOT_FOUND',
] as const;

export type MailCoreErrorCode = (typeof mailCoreErrorCodes)[number];

export interface MailCoreErrorDetails {
  readonly entityId?: string;
}

type MailCoreErrorDetailsInput = Readonly<Record<string, unknown>>;

function sanitizeDetails(
  details: MailCoreErrorDetailsInput,
): MailCoreErrorDetails {
  return typeof details.entityId === 'string'
    ? { entityId: details.entityId }
    : {};
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
