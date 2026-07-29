import type { ResolvedCredential } from '../../contracts';
import { OutlookApiError } from './errors';

export type MicrosoftGraphResponse = {
  status: number;
  headers: Headers;
  json: unknown;
  bytes: Uint8Array;
};

export type MicrosoftGraphRequest = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
};

export interface MicrosoftGraphTransport {
  request(input: MicrosoftGraphRequest): Promise<MicrosoftGraphResponse>;
}

const MAX_PROVIDER_RESPONSE_BYTES = 32 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

const readResponseBody = async (
  response: Response,
): Promise<{ bytes: Uint8Array; json: unknown }> => {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new OutlookApiError('OUTLOOK_RESPONSE_TOO_LARGE');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new OutlookApiError('OUTLOOK_RESPONSE_TOO_LARGE');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('json') || bytes.byteLength === 0) {
    return { bytes, json: null };
  }
  try {
    return {
      bytes,
      json: JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    };
  } catch {
    return { bytes, json: null };
  }
};

export const createMicrosoftGraphTransport = (
  credential: ResolvedCredential,
  fetcher: typeof fetch = fetch,
): MicrosoftGraphTransport => {
  if (credential.type !== 'oauth2') {
    throw new OutlookApiError('OUTLOOK_OAUTH_CREDENTIAL_REQUIRED');
  }
  return {
    request: async ({ method, url, headers = {}, body }) => {
      const response = await fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          ...headers,
        },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const { bytes, json } = await readResponseBody(response);
      if (!response.ok) {
        const apiCode =
          typeof json === 'object' &&
          json !== null &&
          'error' in json &&
          typeof json.error === 'object' &&
          json.error !== null &&
          'code' in json.error
            ? String(json.error.code)
            : `HTTP_${response.status}`;
        throw new OutlookApiError(`OUTLOOK_GRAPH_${apiCode}`, response.status);
      }
      return {
        status: response.status,
        headers: response.headers,
        json,
        bytes,
      };
    },
  };
};
