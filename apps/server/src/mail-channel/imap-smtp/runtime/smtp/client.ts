import { format } from 'node:util';
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

export type SmtpDiagnosticLogger = {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
};

type SmtpPhase =
  | 'preparing_message'
  | 'resolving_endpoint'
  | 'connecting'
  | 'connected'
  | 'smtp_greeting_received'
  | 'smtp_handshake'
  | 'authenticating'
  | 'authenticated'
  | 'mail_from'
  | 'rcpt_to'
  | 'awaiting_data_response'
  | 'streaming_message'
  | 'awaiting_provider_response'
  | 'completed';

type SmtpDiagnostics = {
  logger: SmtpDiagnosticLogger;
  messageId: string;
  rawSizeBytes: number;
  rcptCount: number;
  startedAt: number;
  smtpHost: string;
  smtpAddress: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  phase: SmtpPhase;
  failurePhase: SmtpPhase | null;
  lastClientCommand: string | null;
  lastServerResponse: string | null;
};

type NodemailerLogEntry = Record<string, unknown>;
type NodemailerLogMethod = (entry: NodemailerLogEntry, message: string, ...args: unknown[]) => void;

const stringField = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const integerField = (record: Record<string, unknown>, key: string): number | null => {
  const raw = record[key];
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
};

const errorFields = (error: unknown): Readonly<Record<string, unknown>> => {
  const record =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  return {
    errorName: stringField(record, 'name'),
    errorCode: stringField(record, 'code'),
    errorMessage: stringField(record, 'message') ?? String(error),
    errorStack: stringField(record, 'stack'),
    smtpCommand: stringField(record, 'command'),
    smtpResponseCode: integerField(record, 'responseCode'),
    smtpResponse: stringField(record, 'response'),
  };
};

const diagnosticFields = (diagnostics: SmtpDiagnostics): Readonly<Record<string, unknown>> => ({
  messageId: diagnostics.messageId,
  smtpHost: diagnostics.smtpHost,
  smtpAddress: diagnostics.smtpAddress,
  smtpPort: diagnostics.smtpPort,
  smtpSecure: diagnostics.smtpSecure,
  smtpPhase: diagnostics.failurePhase ?? diagnostics.phase,
  lastClientCommand: diagnostics.lastClientCommand,
  lastServerResponse: diagnostics.lastServerResponse,
  rawSizeBytes: diagnostics.rawSizeBytes,
  rcptCount: diagnostics.rcptCount,
  elapsedMs: Date.now() - diagnostics.startedAt,
  connectionTimeoutMs: 15_000,
  greetingTimeoutMs: 15_000,
  socketTimeoutMs: 300_000,
});

const clientPhase = (command: string, current: SmtpPhase): SmtpPhase => {
  const normalized = command.trimStart().toUpperCase();
  if (normalized.startsWith('EHLO ') || normalized.startsWith('HELO ')) return 'smtp_handshake';
  if (normalized.startsWith('MAIL FROM:')) return 'mail_from';
  if (normalized.startsWith('RCPT TO:')) return 'rcpt_to';
  if (normalized === 'DATA') return 'awaiting_data_response';
  if (normalized.startsWith('AUTH ') || current === 'authenticating') return 'authenticating';
  return current;
};

const updateProtocolState = (
  diagnostics: SmtpDiagnostics,
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
  entry: NodemailerLogEntry,
  protocolMessage: string,
): void => {
  const transaction = stringField(entry, 'tnx');
  if (transaction === 'network' && stringField(entry, 'remoteAddress') !== null) {
    diagnostics.phase = 'connected';
  } else if (transaction === 'server') {
    diagnostics.lastServerResponse = protocolMessage;
    if (diagnostics.phase === 'connected' && protocolMessage.startsWith('220')) {
      diagnostics.phase = 'smtp_greeting_received';
    } else if (
      diagnostics.phase === 'awaiting_data_response' &&
      protocolMessage.startsWith('354')
    ) {
      diagnostics.phase = 'streaming_message';
    }
  } else if (transaction === 'client') {
    diagnostics.lastClientCommand = protocolMessage;
    diagnostics.phase = clientPhase(protocolMessage, diagnostics.phase);
  } else if (transaction === 'smtp' && stringField(entry, 'action') === 'authenticated') {
    diagnostics.phase = 'authenticated';
  } else if (transaction === 'message' && integerField(entry, 'outByteCount') !== null) {
    diagnostics.phase = 'awaiting_provider_response';
  }
  if (
    (level === 'warn' || level === 'error' || level === 'fatal') &&
    diagnostics.failurePhase === null
  ) {
    diagnostics.failurePhase = diagnostics.phase;
  }
};

const createNodemailerLogger = (diagnostics: SmtpDiagnostics) => {
  const write = (
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    entry: NodemailerLogEntry,
    message: string,
    args: unknown[],
  ): void => {
    const protocolMessage = format(message, ...args);
    updateProtocolState(diagnostics, level, entry, protocolMessage);
    const fields = {
      ...diagnosticFields(diagnostics),
      nodemailerLevel: level,
      nodemailerComponent: stringField(entry, 'component'),
      smtpSessionId: stringField(entry, 'sid'),
      smtpTransaction: stringField(entry, 'tnx'),
      protocolMessage,
      protocolDetails: entry,
    };
    if (level === 'warn' || level === 'error' || level === 'fatal') {
      diagnostics.logger.error('mail.smtp.protocol_error', fields);
      return;
    }
    diagnostics.logger.info('mail.smtp.protocol_trace', fields);
  };
  const method =
    (level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'): NodemailerLogMethod =>
    (entry, message, ...args) =>
      write(level, entry, message, args);
  return {
    trace: method('trace'),
    debug: method('debug'),
    info: method('info'),
    warn: method('warn'),
    error: method('error'),
    fatal: method('fatal'),
  };
};

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
  diagnostics?: SmtpDiagnostics,
): Promise<SmtpTransport> => {
  if (diagnostics !== undefined) diagnostics.phase = 'resolving_endpoint';
  const endpoint = await resolveMailEndpoint(credential.smtp, allowedHosts);
  if (diagnostics !== undefined) {
    diagnostics.smtpAddress = endpoint.address;
    diagnostics.phase = 'connecting';
    diagnostics.logger.info('mail.smtp.endpoint_resolved', diagnosticFields(diagnostics));
  }
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
    ...(diagnostics === undefined
      ? {}
      : {
          logger: createNodemailerLogger(diagnostics),
          transactionLog: true,
        }),
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
  logger?: SmtpDiagnosticLogger,
): Promise<SmtpSendResponse> => {
  let transport: SmtpTransport | null = null;
  const raw = Buffer.from(request.rawMimeBase64, 'base64');
  const diagnostics: SmtpDiagnostics | undefined =
    logger === undefined
      ? undefined
      : {
          logger,
          messageId: request.messageId,
          rawSizeBytes: raw.byteLength,
          rcptCount: request.envelope.to.length,
          startedAt: Date.now(),
          smtpHost: request.credential.smtp.host,
          smtpAddress: null,
          smtpPort: request.credential.smtp.port,
          smtpSecure: request.credential.smtp.secure,
          phase: 'preparing_message',
          failurePhase: null,
          lastClientCommand: null,
          lastServerResponse: null,
        };
  try {
    diagnostics?.logger.info('mail.smtp.send_started', diagnosticFields(diagnostics));
    if (
      raw.byteLength === 0 ||
      raw.byteLength > MAX_RAW_MESSAGE_BYTES ||
      !containsMessageId(raw, request.messageId)
    ) {
      throw new MailProtocolOperationError('SMTP_INVALID_MIME', 'permanent');
    }
    transport = await createTransport(request.credential, allowedHosts, diagnostics);
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
    const response = parseSmtpSendResponse({
      accepted: true,
      responseCode: responseCode(result.response),
      providerResponse: typeof result.response === 'string' ? result.response.slice(0, 512) : null,
    });
    if (diagnostics !== undefined) {
      diagnostics.phase = 'completed';
      diagnostics.logger.info('mail.smtp.send_succeeded', {
        ...diagnosticFields(diagnostics),
        smtpResponseCode: response.responseCode,
        smtpResponse: response.providerResponse,
      });
    }
    return response;
  } catch (error) {
    const classified = classifyMailProtocolError(error, 'smtp_send');
    diagnostics?.logger.error('mail.smtp.send_failed', {
      ...diagnosticFields(diagnostics),
      ...errorFields(error),
      classification: classified.classification,
      providerCode: classified.code,
    });
    throw classified;
  } finally {
    transport?.close();
  }
};
