export type MailSyncErrorClassification = 'retryable' | 'authentication' | 'permanent';

export class MailSyncError extends Error {
  constructor(
    readonly code: string,
    readonly classification: MailSyncErrorClassification,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'MailSyncError';
  }
}
