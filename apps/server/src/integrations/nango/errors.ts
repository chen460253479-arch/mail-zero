import { NangoClientError, type NangoOperation } from './client';

export type NangoIntegrationErrorCode =
  | 'INTEGRATION_IN_USE'
  | 'NANGO_API_KEY_INVALID'
  | 'NANGO_CONNECTION_INVALID'
  | 'NANGO_CONNECTION_NOT_FOUND'
  | 'NANGO_ENDPOINT_NOT_FOUND'
  | 'NANGO_INTEGRATION_UNAVAILABLE'
  | 'NANGO_INSUFFICIENT_PERMISSIONS'
  | 'NANGO_INVALID_RESPONSE'
  | 'NANGO_NOT_CONFIGURED'
  | 'NANGO_REQUEST_FAILED'
  | 'NANGO_UNREACHABLE';

export class NangoIntegrationError extends Error {
  constructor(
    public readonly code: NangoIntegrationErrorCode,
    public readonly operation?: NangoOperation,
    public readonly status?: number | null,
  ) {
    super(operation ? `${code}|${operation}|${status ?? ''}` : code);
    this.name = 'NangoIntegrationError';
  }
}

export const mapNangoClientError = (error: unknown): NangoIntegrationError => {
  if (!(error instanceof NangoClientError)) {
    return new NangoIntegrationError('NANGO_REQUEST_FAILED');
  }

  const code: NangoIntegrationErrorCode =
    error.code === 'INVALID_API_KEY'
      ? 'NANGO_API_KEY_INVALID'
      : error.code === 'INSUFFICIENT_PERMISSIONS'
        ? 'NANGO_INSUFFICIENT_PERMISSIONS'
        : error.code === 'ENDPOINT_NOT_FOUND'
          ? error.operation === 'get_connection'
            ? 'NANGO_CONNECTION_NOT_FOUND'
            : 'NANGO_ENDPOINT_NOT_FOUND'
          : error.code === 'INVALID_CREDENTIALS'
            ? 'NANGO_CONNECTION_INVALID'
            : error.code === 'INVALID_RESPONSE'
              ? 'NANGO_INVALID_RESPONSE'
              : error.status === null
                ? 'NANGO_UNREACHABLE'
                : 'NANGO_REQUEST_FAILED';

  return new NangoIntegrationError(code, error.operation, error.status);
};
