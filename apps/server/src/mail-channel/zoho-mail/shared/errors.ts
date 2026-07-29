import type { MailSyncErrorClassification } from '../../../modules/mail-sync';
import type { OutboundErrorClassification } from '../../contracts';

export class ZohoMailApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number | null = null,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'ZohoMailApiError';
  }
}

export const zohoMailErrorStatus = (error: unknown): number | null => {
  if (error instanceof ZohoMailApiError) return error.status;
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { status?: unknown; response?: { status?: unknown }; cause?: unknown };
  const status = candidate.status ?? candidate.response?.status;
  if (typeof status === 'number') return status;
  return candidate.cause === undefined ? null : zohoMailErrorStatus(candidate.cause);
};

export const classifyZohoMailError = (error: unknown): MailSyncErrorClassification => {
  const status = zohoMailErrorStatus(error);
  if (status === 401 || status === 403) return 'authentication';
  if (status === 408 || status === 409 || status === 429 || (status !== null && status >= 500)) {
    return 'retryable';
  }
  return 'permanent';
};

export const classifyZohoMailOutboundError = (
  error: unknown,
  now: Date,
): OutboundErrorClassification => {
  const status = zohoMailErrorStatus(error);
  if (status === 401 || status === 403) {
    return {
      kind: 'authentication_required',
      providerCode: String(status),
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
      error instanceof ZohoMailApiError ? error.code : status === null ? null : String(status),
    safeResponse: 'permanent_failure',
    retryAfter: null,
  };
};
