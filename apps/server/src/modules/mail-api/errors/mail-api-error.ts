export const mailApiErrorCodes = [
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_NOT_ACTIVE',
  'STATE_MISMATCH',
  'REVISION_MISMATCH',
  'INVALID_ARGUMENTS',
  'INVALID_CURSOR',
  'NOT_FOUND',
  'FORBIDDEN',
  'OVER_QUOTA',
  'REQUEST_TOO_LARGE',
  'MAILBOX_HAS_CHILD',
  'MAILBOX_HAS_EMAIL',
  'SUBMISSION_NOT_CANCELABLE',
  'STORAGE_FAILURE',
] as const;

export type MailApiErrorCode = (typeof mailApiErrorCodes)[number];

export type MailApiErrorData = {
  code: MailApiErrorCode;
  retryable: boolean;
  requestId: string;
};

export class MailApiError extends Error {
  readonly code: MailApiErrorCode;
  readonly retryable: boolean;
  readonly requestId: string;

  constructor(data: MailApiErrorData) {
    super(data.code);
    this.name = 'MailApiError';
    this.code = data.code;
    this.retryable = data.retryable;
    this.requestId = data.requestId;
  }

  toJSON(): MailApiErrorData {
    return {
      code: this.code,
      retryable: this.retryable,
      requestId: this.requestId,
    };
  }
}
