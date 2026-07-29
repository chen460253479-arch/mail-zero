import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ZodError } from 'zod';

import {
  parseImapBaselineRequest,
  parseImapDiscoverRequest,
  parseImapRawRequest,
  parseProtocolVerifyRequest,
  parseSmtpSendRequest,
} from './contracts';
import { discoverImapMessages, establishImapBaseline, fetchImapRawMessage } from './imap/client';
import { classifyMailProtocolError, MailProtocolOperationError } from './errors';
import { sendSmtpMessage, verifySmtpConnection } from './smtp/client';

const MAX_REQUEST_BYTES = 40 * 1024 * 1024;
const MAX_CONCURRENT_REQUESTS = 20;

type ProtocolWorkerEnvironment = {
  secret: string;
  allowedHosts?: string;
};

const hashSecret = (value: string): Buffer => createHash('sha256').update(value).digest();

const authorized = (request: IncomingMessage, expectedSecret: string): boolean => {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = hashSecret(header.slice('Bearer '.length));
  const expected = hashSecret(expectedSecret);
  return supplied.byteLength === expected.byteLength && timingSafeEqual(supplied, expected);
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      throw new MailProtocolOperationError('MAIL_PROTOCOL_REQUEST_TOO_LARGE', 'permanent');
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    throw new MailProtocolOperationError('MAIL_PROTOCOL_INVALID_JSON', 'permanent', {
      cause: error,
    });
  }
};

const writeJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
};

const errorStatus = (error: MailProtocolOperationError): number => {
  switch (error.classification) {
    case 'authentication':
      return 401;
    case 'permanent':
      return 400;
    case 'retryable':
      return 503;
    case 'uncertain':
      return 502;
  }
};

export const createMailProtocolServer = (environment: ProtocolWorkerEnvironment) => {
  if (environment.secret.length < 32) {
    throw new Error('MAIL_PROTOCOL_WORKER_SECRET_TOO_SHORT');
  }
  let activeRequests = 0;

  return createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      writeJson(response, 200, { status: 'ok' });
      return;
    }
    if (request.method !== 'POST' || request.url === undefined) {
      writeJson(response, 404, {
        error: { code: 'NOT_FOUND', classification: 'permanent' },
      });
      return;
    }
    if (!authorized(request, environment.secret)) {
      writeJson(response, 401, {
        error: { code: 'MAIL_PROTOCOL_UNAUTHORIZED', classification: 'permanent' },
      });
      return;
    }
    if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
      writeJson(response, 503, {
        error: { code: 'MAIL_PROTOCOL_BUSY', classification: 'retryable' },
      });
      return;
    }

    activeRequests += 1;
    try {
      const body = await readJsonBody(request);
      switch (request.url) {
        case '/v1/verify': {
          const input = parseProtocolVerifyRequest(body);
          await establishImapBaseline(
            { credential: input.credential, mailbox: 'INBOX' },
            environment.allowedHosts,
          );
          await verifySmtpConnection(input.credential, environment.allowedHosts);
          writeJson(response, 200, { email: input.credential.email });
          return;
        }
        case '/v1/imap/baseline':
          writeJson(
            response,
            200,
            await establishImapBaseline(parseImapBaselineRequest(body), environment.allowedHosts),
          );
          return;
        case '/v1/imap/discover':
          writeJson(
            response,
            200,
            await discoverImapMessages(parseImapDiscoverRequest(body), environment.allowedHosts),
          );
          return;
        case '/v1/imap/raw':
          writeJson(
            response,
            200,
            await fetchImapRawMessage(parseImapRawRequest(body), environment.allowedHosts),
          );
          return;
        case '/v1/smtp/send':
          writeJson(
            response,
            200,
            await sendSmtpMessage(parseSmtpSendRequest(body), environment.allowedHosts),
          );
          return;
        default:
          writeJson(response, 404, {
            error: { code: 'NOT_FOUND', classification: 'permanent' },
          });
      }
    } catch (error) {
      const classified =
        error instanceof ZodError
          ? new MailProtocolOperationError('MAIL_PROTOCOL_INVALID_REQUEST', 'permanent')
          : classifyMailProtocolError(error, 'verify');
      console.error('[MAIL_PROTOCOL_WORKER] request failed', {
        path: request.url,
        code: classified.code,
        classification: classified.classification,
      });
      writeJson(response, errorStatus(classified), {
        error: {
          code: classified.code,
          classification: classified.classification,
        },
      });
    } finally {
      activeRequests -= 1;
    }
  });
};

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const secret = process.env.MAIL_PROTOCOL_WORKER_SECRET ?? '';
  const port = Number(process.env.MAIL_PROTOCOL_WORKER_PORT ?? '8790');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('MAIL_PROTOCOL_WORKER_PORT_INVALID');
  }
  createMailProtocolServer({
    secret,
    allowedHosts: process.env.MAIL_PROTOCOL_ALLOWED_HOSTS,
  }).listen(port, '0.0.0.0', () => {
    console.log(`[MAIL_PROTOCOL_WORKER] listening on port ${port}`);
  });
}
