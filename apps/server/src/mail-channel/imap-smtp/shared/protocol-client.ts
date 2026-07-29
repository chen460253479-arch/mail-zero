import {
  parseImapBaselineResponse,
  parseImapDiscoverResponse,
  parseImapRawResponse,
  parseProtocolVerifyResponse,
  parseSmtpSendResponse,
  protocolWorkerProblemSchema,
  type ImapBaselineResponse,
  type ImapDiscoverResponse,
  type ImapPageCursor,
  type ImapRawResponse,
  type ProtocolVerifyResponse,
  type SmtpSendResponse,
} from '../../../protocol-worker/contracts';
import type { ImapSmtpCredential } from '../../contracts';

export type ProtocolFailureClassification =
  | 'authentication'
  | 'retryable'
  | 'permanent'
  | 'uncertain';

export class MailProtocolWorkerError extends Error {
  constructor(
    public readonly code: string,
    public readonly classification: ProtocolFailureClassification,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'MailProtocolWorkerError';
  }
}

export type MailProtocolClient = {
  verify(): Promise<ProtocolVerifyResponse>;
  establishImapBaseline(): Promise<ImapBaselineResponse>;
  discoverImap(input: {
    expectedUidValidity: string;
    nextUid: number;
    lastSuccessfulAt: string;
    cursor: ImapPageCursor | null;
    limit: number;
  }): Promise<ImapDiscoverResponse>;
  fetchImapRaw(input: { uidValidity: string; uid: number }): Promise<ImapRawResponse>;
  sendSmtp(input: {
    envelope: { from: string; to: string[] };
    rawMimeBase64: string;
    messageId: string;
  }): Promise<SmtpSendResponse>;
};

type ResponseParser<T> = (value: unknown) => T;

const parseBaseUrl = (value: string): URL => {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw new Error('MAIL_PROTOCOL_WORKER_INVALID_URL');
  }
  return url;
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.length > 64 * 1024) {
    throw new MailProtocolWorkerError('MAIL_PROTOCOL_WORKER_RESPONSE_TOO_LARGE', 'retryable');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new MailProtocolWorkerError('MAIL_PROTOCOL_WORKER_INVALID_RESPONSE', 'retryable', {
      cause: error,
    });
  }
};

export const createMailProtocolWorkerClient = (input: {
  baseUrl: string;
  secret: string;
  credential: ImapSmtpCredential;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): MailProtocolClient => {
  const baseUrl = parseBaseUrl(input.baseUrl);
  if (input.secret.length < 32) {
    throw new Error('MAIL_PROTOCOL_WORKER_SECRET_TOO_SHORT');
  }
  const requestFetch = input.fetch ?? fetch;
  const timeoutMs = input.timeoutMs ?? 30_000;

  const request = async <T>(
    path: string,
    body: Record<string, unknown>,
    parse: ResponseParser<T>,
    networkFailure: ProtocolFailureClassification,
  ): Promise<T> => {
    let response: Response;
    try {
      response = await requestFetch(new URL(path, baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.secret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ credential: input.credential, ...body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new MailProtocolWorkerError('MAIL_PROTOCOL_WORKER_UNAVAILABLE', networkFailure, {
        cause: error,
      });
    }
    const payload = await parseResponseBody(response);
    if (!response.ok) {
      const problem = protocolWorkerProblemSchema.safeParse(payload);
      if (problem.success) {
        throw new MailProtocolWorkerError(
          problem.data.error.code,
          problem.data.error.classification,
        );
      }
      throw new MailProtocolWorkerError(
        `MAIL_PROTOCOL_WORKER_HTTP_${response.status}`,
        response.status >= 500 ? networkFailure : 'permanent',
      );
    }
    try {
      return parse(payload);
    } catch (error) {
      throw new MailProtocolWorkerError('MAIL_PROTOCOL_WORKER_INVALID_RESPONSE', networkFailure, {
        cause: error,
      });
    }
  };

  return {
    verify: async () => await request('/v1/verify', {}, parseProtocolVerifyResponse, 'retryable'),
    establishImapBaseline: async () =>
      await request(
        '/v1/imap/baseline',
        { mailbox: 'INBOX' },
        parseImapBaselineResponse,
        'retryable',
      ),
    discoverImap: async (discoverInput) =>
      await request(
        '/v1/imap/discover',
        { mailbox: 'INBOX', ...discoverInput },
        parseImapDiscoverResponse,
        'retryable',
      ),
    fetchImapRaw: async (rawInput) =>
      await request(
        '/v1/imap/raw',
        { mailbox: 'INBOX', ...rawInput },
        parseImapRawResponse,
        'retryable',
      ),
    sendSmtp: async (sendInput) =>
      await request('/v1/smtp/send', sendInput, parseSmtpSendResponse, 'uncertain'),
  };
};
