import type { MailSyncErrorClassification } from '../../../modules/mail-sync';
import type { OutboundErrorClassification } from '../../contracts';

export class OutlookApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number | null = null,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'OutlookApiError';
  }
}

export const outlookErrorStatus = (error: unknown): number | null => {
  if (error instanceof OutlookApiError) return error.status;
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as {
    status?: unknown;
    response?: { status?: unknown };
    cause?: unknown;
  };
  const value = candidate.status ?? candidate.response?.status;
  if (typeof value === 'number') return value;
  return candidate.cause === undefined ? null : outlookErrorStatus(candidate.cause);
};

export const classifyOutlookError = (error: unknown): MailSyncErrorClassification => {
  const status = outlookErrorStatus(error);
  if (status === 401 || status === 403) return 'authentication';
  if (status === 408 || status === 409 || status === 429 || (status !== null && status >= 500)) {
    return 'retryable';
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'].includes(String(error.code))
  ) {
    return 'retryable';
  }
  return 'permanent';
};

export const classifyOutlookOutboundError = (
  error: unknown,
  now: Date,
): OutboundErrorClassification => {
  const status = outlookErrorStatus(error);
  if (status === 401 || status === 403) {
    return {
      kind: 'authentication_required',
      providerCode: status === null ? null : String(status),
      safeResponse: 'authentication_required',
      retryAfter: null,
    };
  }
  if (status === 429) {
    return {
      kind: 'rate_limited',
      providerCode: '429',
      safeResponse: 'rate_limited',
      retryAfter: new Date(now.getTime() + 60_000),
    };
  }
  if (status === 413) {
    return {
      kind: 'payload_too_large',
      providerCode: '413',
      safeResponse: 'payload_too_large',
      retryAfter: null,
    };
  }
  if (status === 408 || status === 409 || (status !== null && status >= 500)) {
    return {
      kind: 'uncertain',
      providerCode: status === null ? null : String(status),
      safeResponse: 'unknown_result',
      retryAfter: null,
    };
  }
  return {
    kind: 'permanent_failure',
    providerCode:
      error instanceof OutlookApiError ? error.code : status === null ? null : String(status),
    safeResponse: 'permanent_failure',
    retryAfter: null,
  };
};
