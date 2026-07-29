import type { ResolvedCredential } from '../../contracts';
import { ZohoMailApiError } from './errors';

export type ZohoMailRequest = {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
};

export type ZohoMailResponse = {
  status: number;
  json: unknown;
  bytes: Uint8Array;
};

export interface ZohoMailTransport {
  request(input: ZohoMailRequest): Promise<ZohoMailResponse>;
}

const MAX_PROVIDER_RESPONSE_BYTES = 32 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

const readResponseBody = async (
  response: Response,
): Promise<{ bytes: Uint8Array; json: unknown }> => {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new ZohoMailApiError('ZOHO_RESPONSE_TOO_LARGE');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new ZohoMailApiError('ZOHO_RESPONSE_TOO_LARGE');
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

export const createZohoMailTransport = (
  credential: ResolvedCredential,
  baseUrl: string,
  fetcher: typeof fetch = fetch,
): ZohoMailTransport => {
  if (credential.type !== 'oauth2') {
    throw new ZohoMailApiError('ZOHO_OAUTH_CREDENTIAL_REQUIRED');
  }
  const trustedOrigin = new URL(baseUrl).origin;
  return {
    request: async ({ method, path, query, headers = {}, body }) => {
      const url = new URL(path, `${trustedOrigin}/`);
      if (url.origin !== trustedOrigin || !url.pathname.startsWith('/api/')) {
        throw new ZohoMailApiError('ZOHO_UNTRUSTED_API_URL');
      }
      for (const [key, value] of Object.entries(query ?? {})) {
        url.searchParams.set(key, value);
      }
      const response = await fetcher(url, {
        method,
        headers: {
          Authorization: `Zoho-oauthtoken ${credential.accessToken}`,
          ...headers,
        },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const { bytes, json } = await readResponseBody(response);
      if (!response.ok) {
        throw new ZohoMailApiError(`ZOHO_HTTP_${response.status}`, response.status);
      }
      return { status: response.status, json, bytes };
    },
  };
};
