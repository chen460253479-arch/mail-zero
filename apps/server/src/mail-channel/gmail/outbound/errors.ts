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

const gmailReasons = (error: unknown): Set<string> => {
  if (typeof error !== 'object' || error === null) return new Set();
  const root = error as Record<string, unknown>;
  const response =
    typeof root.response === 'object' && root.response !== null
      ? (root.response as Record<string, unknown>)
      : {};
  const data =
    typeof response.data === 'object' && response.data !== null
      ? (response.data as Record<string, unknown>)
      : {};
  const apiError =
    typeof data.error === 'object' && data.error !== null
      ? (data.error as Record<string, unknown>)
      : {};
  const details = [root.errors, data.errors, apiError.errors].flatMap((candidate) =>
    Array.isArray(candidate) ? candidate : [],
  );
  return new Set(
    details.flatMap((detail) =>
      typeof detail === 'object' &&
      detail !== null &&
      typeof (detail as Record<string, unknown>).reason === 'string'
        ? [(detail as Record<string, string>).reason.toLowerCase()]
        : [],
    ),
  );
};

const hasAnyReason = (reasons: Set<string>, expected: readonly string[]): boolean =>
  expected.some((reason) => reasons.has(reason.toLowerCase()));

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
  const reasons = gmailReasons(error);
  if (status === 429 || hasAnyReason(reasons, ['rateLimitExceeded', 'userRateLimitExceeded'])) {
    return {
      kind: 'rate_limited',
      providerCode: status === null ? null : String(status),
      safeResponse: 'rate_limited',
      retryAfter: retryAfter(error, now),
    };
  }
  if (hasAnyReason(reasons, ['quotaExceeded', 'dailyLimitExceeded'])) {
    return {
      kind: 'quota_exceeded',
      providerCode: status === null ? null : String(status),
      safeResponse: 'quota_exceeded',
      retryAfter: retryAfter(error, now),
    };
  }
  if (hasAnyReason(reasons, ['invalidRecipient'])) {
    return {
      kind: 'invalid_recipient',
      providerCode: status === null ? null : String(status),
      safeResponse: 'invalid_recipient',
      retryAfter: null,
    };
  }
  if (hasAnyReason(reasons, ['domainPolicy', 'forbidden'])) {
    return {
      kind: 'policy_rejected',
      providerCode: status === null ? null : String(status),
      safeResponse: 'policy_rejected',
      retryAfter: null,
    };
  }
  if (
    status === 401 ||
    status === 403 ||
    hasAnyReason(reasons, ['authError', 'insufficientPermissions'])
  ) {
    return {
      kind: 'authentication_required',
      providerCode: String(status),
      safeResponse: 'authentication_required',
      retryAfter: null,
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
