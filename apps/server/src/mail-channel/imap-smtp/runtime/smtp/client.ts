import { isIP } from 'node:net';

import {
  parseSmtpSendResponse,
  type ImapSmtpCredentialInput,
  type SmtpSendRequest,
  type SmtpSendResponse,
} from '../../shared/contracts';
import { classifyMailProtocolError, MailProtocolOperationError } from '../../shared/errors';
import { resolveMailEndpoint } from '../network';

const MAX_RAW_MESSAGE_BYTES = 25 * 1024 * 1024;

type SmtpTransport = {
  verify(): Promise<true>;
  sendMail(input: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<{
    accepted?: Array<string | { address?: string }>;
    rejected?: Array<string | { address?: string }>;
    response?: string;
  }>;
  close(): void;
};

const createTransport = async (
  credential: ImapSmtpCredentialInput,
  allowedHosts: string | undefined,
): Promise<SmtpTransport> => {
  const endpoint = await resolveMailEndpoint(credential.smtp, allowedHosts);
  const module = await import('nodemailer');
  return module.default.createTransport({
    host: endpoint.address,
    port: endpoint.port,
    secure: endpoint.secure,
    requireTLS: !endpoint.secure,
    auth: {
      user: credential.username,
      pass: credential.password,
    },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 300_000,
    tls: {
      rejectUnauthorized: true,
      servername: isIP(endpoint.originalHost) === 0 ? endpoint.originalHost : undefined,
    },
  }) as unknown as SmtpTransport;
};

export const verifySmtpConnection = async (
  credential: ImapSmtpCredentialInput,
  allowedHosts: string | undefined,
): Promise<void> => {
  let transport: SmtpTransport | null = null;
  try {
    transport = await createTransport(credential, allowedHosts);
    await transport.verify();
  } catch (error) {
    throw classifyMailProtocolError(error, 'verify');
  } finally {
    transport?.close();
  }
};

const containsMessageId = (raw: Buffer, messageId: string): boolean => {
  const headerEnd = raw.indexOf(Buffer.from('\r\n\r\n'));
  const alternativeHeaderEnd = raw.indexOf(Buffer.from('\n\n'));
  const end =
    headerEnd >= 0
      ? headerEnd
      : alternativeHeaderEnd >= 0
        ? alternativeHeaderEnd
        : Math.min(raw.byteLength, 256 * 1024);
  const header = raw.subarray(0, Math.min(end, 256 * 1024)).toString('latin1');
  return header
    .split(/\r?\n/u)
    .some(
      (line) =>
        line.toLocaleLowerCase('en-US').startsWith('message-id:') &&
        line.slice(line.indexOf(':') + 1).trim() === messageId,
    );
};

const responseCode = (response: string | undefined): number => {
  const code = Number(/^(\d{3})/u.exec(response ?? '')?.[1]);
  if (!Number.isInteger(code) || code < 200 || code > 299) {
    throw new MailProtocolOperationError('SMTP_INVALID_SUCCESS_RESPONSE', 'uncertain');
  }
  return code;
};

export const sendSmtpMessage = async (
  request: SmtpSendRequest,
  allowedHosts: string | undefined,
): Promise<SmtpSendResponse> => {
  let transport: SmtpTransport | null = null;
  try {
    const raw = Buffer.from(request.rawMimeBase64, 'base64');
    if (
      raw.byteLength === 0 ||
      raw.byteLength > MAX_RAW_MESSAGE_BYTES ||
      !containsMessageId(raw, request.messageId)
    ) {
      throw new MailProtocolOperationError('SMTP_INVALID_MIME', 'permanent');
    }
    transport = await createTransport(request.credential, allowedHosts);
    const result = await transport.sendMail({
      envelope: request.envelope,
      raw,
    });
    const accepted = result.accepted?.length ?? 0;
    const rejected = result.rejected?.length ?? 0;
    if (accepted !== request.envelope.to.length || rejected > 0) {
      throw new MailProtocolOperationError(
        accepted > 0 ? 'SMTP_PARTIAL_ACCEPTANCE' : 'SMTP_RECIPIENTS_REJECTED',
        accepted > 0 ? 'uncertain' : 'permanent',
      );
    }
    return parseSmtpSendResponse({
      accepted: true,
      responseCode: responseCode(result.response),
      providerResponse: typeof result.response === 'string' ? result.response.slice(0, 512) : null,
    });
  } catch (error) {
    throw classifyMailProtocolError(error, 'smtp_send');
  } finally {
    transport?.close();
  }
};
