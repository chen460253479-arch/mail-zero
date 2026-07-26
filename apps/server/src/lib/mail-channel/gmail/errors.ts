import { MailSyncError } from '../../../modules/mail-sync';

const readErrorValue = (error: unknown, key: string): unknown => {
  if (error === null || typeof error !== 'object') {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  return record[key] ?? readErrorValue(record.response, key) ?? readErrorValue(record.cause, key);
};

export const gmailErrorStatus = (error: unknown): number | null => {
  const status = readErrorValue(error, 'status') ?? readErrorValue(error, 'code');
  if (typeof status === 'number' && Number.isInteger(status)) {
    return status;
  }
  if (typeof status === 'string' && /^[1-5]\d{2}$/u.test(status)) {
    return Number(status);
  }
  return null;
};

export const classifyGmailError = (
  error: unknown,
): 'retryable' | 'authentication' | 'permanent' => {
  if (error instanceof MailSyncError) {
    return error.classification;
  }
  const status = gmailErrorStatus(error);
  if (status === 401 || status === 403) {
    return 'authentication';
  }
  if (status === 429 || (status !== null && status >= 500)) {
    return 'retryable';
  }
  const code = readErrorValue(error, 'code');
  if (
    typeof code === 'string' &&
    ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'].includes(code)
  ) {
    return 'retryable';
  }
  return 'permanent';
};
