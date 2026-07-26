import type { OutboundErrorClassification } from '../../contracts';
import { gmailErrorStatus } from '../shared/errors';

export type GmailOutboundErrorCode = 'GMAIL_INVALID_REQUEST' | 'GMAIL_INVALID_RESPONSE';

export class GmailOutboundError extends Error {
  constructor(public readonly code: GmailOutboundErrorCode) {
    super(code);
    this.name = 'GmailOutboundError';
  }
}

const nestedValue = (error: unknown, key: string): unknown => {
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as Record<string, unknown>;
  return record[key] ?? nestedValue(record.response, key) ?? nestedValue(record.cause, key);
};

const retryAfter = (error: unknown, now: Date): Date | null => {
  const headers = nestedValue(error, 'headers');
  if (typeof headers !== 'object' || headers === null) return null;
  const record = headers as Record<string, unknown>;
  const value = record['retry-after'] ?? record['Retry-After'];
  if (typeof value !== 'string') return null;
  const seconds = Number(value);
  const candidate = Number.isFinite(seconds)
    ? new Date(now.getTime() + seconds * 1_000)
    : new Date(value);
  const delay = candidate.getTime() - now.getTime();
  return Number.isFinite(candidate.getTime()) && delay > 0 && delay <= 86_400_000
    ? candidate
    : null;
};

export const classifyGmailOutboundError = (
  error: unknown,
  now: Date,
): OutboundErrorClassification => {
  if (error instanceof GmailOutboundError) {
    return {
      kind: 'permanent_failure',
      providerCode: error.code,
      safeResponse: 'permanent_failure',
      retryAfter: null,
    };
  }
  const status = gmailErrorStatus(error);
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
      retryAfter: retryAfter(error, now),
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
  const code = nestedValue(error, 'code');
  if (
    (status !== null && status >= 500) ||
    (typeof code === 'string' &&
      ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'].includes(code))
  ) {
    return {
      kind: 'uncertain',
      providerCode: status === null ? (typeof code === 'string' ? code : null) : String(status),
      safeResponse: 'unknown_result',
      retryAfter: null,
    };
  }
  return {
    kind: 'permanent_failure',
    providerCode: status === null ? null : String(status),
    safeResponse: 'permanent_failure',
    retryAfter: null,
  };
};
