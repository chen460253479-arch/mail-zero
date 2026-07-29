type ProtocolFailureClassification = 'authentication' | 'retryable' | 'permanent' | 'uncertain';

export class MailProtocolOperationError extends Error {
  constructor(
    public readonly code: string,
    public readonly classification: ProtocolFailureClassification,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'MailProtocolOperationError';
  }
}

const errorRecord = (error: unknown): Record<string, unknown> =>
  typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};

export const classifyMailProtocolError = (
  error: unknown,
  operation: 'imap' | 'verify' | 'smtp_send',
): MailProtocolOperationError => {
  if (error instanceof MailProtocolOperationError) return error;
  const record = errorRecord(error);
  const code = String(record.code ?? '');
  const command = String(record.command ?? '');
  const responseCode = Number(record.responseCode);
  const authenticationFailed =
    record.authenticationFailed === true || code === 'EAUTH' || command === 'AUTH';
  if (authenticationFailed) {
    return new MailProtocolOperationError(
      operation === 'imap' ? 'IMAP_AUTHENTICATION_FAILED' : 'SMTP_AUTHENTICATION_FAILED',
      'authentication',
      { cause: error },
    );
  }
  if (operation === 'smtp_send') {
    if (Number.isInteger(responseCode) && responseCode >= 500) {
      return new MailProtocolOperationError('SMTP_PERMANENT_REJECTION', 'permanent', {
        cause: error,
      });
    }
    if (
      (Number.isInteger(responseCode) && responseCode >= 400) ||
      command === 'CONN' ||
      command === 'EHLO' ||
      command === 'HELO' ||
      command === 'STARTTLS' ||
      command === 'MAIL FROM' ||
      command === 'RCPT TO'
    ) {
      return new MailProtocolOperationError('SMTP_TEMPORARY_FAILURE', 'retryable', {
        cause: error,
      });
    }
    return new MailProtocolOperationError('SMTP_RESULT_UNKNOWN', 'uncertain', {
      cause: error,
    });
  }
  return new MailProtocolOperationError(
    operation === 'imap' ? 'IMAP_OPERATION_FAILED' : 'MAIL_PROTOCOL_VERIFY_FAILED',
    'retryable',
    { cause: error },
  );
};
