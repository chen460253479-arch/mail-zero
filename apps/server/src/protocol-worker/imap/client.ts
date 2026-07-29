import { isIP } from 'node:net';

import {
  parseImapBaselineResponse,
  parseImapDiscoverResponse,
  parseImapRawResponse,
  type ImapBaselineRequest,
  type ImapBaselineResponse,
  type ImapDiscoverRequest,
  type ImapDiscoverResponse,
  type ImapRawRequest,
  type ImapRawResponse,
} from '../contracts';
import { classifyMailProtocolError, MailProtocolOperationError } from '../errors';
import { createImapScanPlan, nextImapPageCursor } from './scan-plan';
import { resolveMailEndpoint } from '../network';

const MAX_RAW_MESSAGE_BYTES = 25 * 1024 * 1024;

type ImapMessage = {
  uid?: number;
  envelope?: { messageId?: string | null };
  internalDate?: Date | null;
  source?: Uint8Array | null;
};

type ImapClient = {
  usable?: boolean;
  connect(): Promise<void>;
  logout(): Promise<void>;
  close(): void;
  on(event: 'error', listener: (error: unknown) => void): void;
  mailboxOpen(path: string): Promise<{
    uidValidity?: bigint | number | string;
    uidNext?: number;
    highestModseq?: bigint | number | string | false;
  }>;
  fetch(
    range: string,
    query: Record<string, boolean>,
    options: { uid: true },
  ): AsyncIterable<ImapMessage>;
  fetchAll(
    range: string,
    query: Record<string, boolean>,
    options: { uid: true },
  ): Promise<ImapMessage[]>;
  fetchOne(
    uid: number,
    query: Record<string, boolean>,
    options: { uid: true },
  ): Promise<ImapMessage | false>;
  search(query: { uid: string; since?: Date }, options: { uid: true }): Promise<number[]>;
};

const requirePositiveText = (value: unknown, code: string): string => {
  const result = String(value ?? '');
  if (!/^[1-9]\d*$/u.test(result)) {
    throw new MailProtocolOperationError(code, 'retryable');
  }
  return result;
};

const mailboxState = (mailbox: {
  uidValidity?: bigint | number | string;
  uidNext?: number;
  highestModseq?: bigint | number | string | false;
}) => ({
  uidValidity: requirePositiveText(mailbox.uidValidity, 'IMAP_UIDVALIDITY_MISSING'),
  uidNext:
    Number.isSafeInteger(mailbox.uidNext) && (mailbox.uidNext ?? 0) > 0 ? mailbox.uidNext! : 1,
  highestModseq:
    mailbox.highestModseq === false || mailbox.highestModseq == null
      ? null
      : requirePositiveText(mailbox.highestModseq, 'IMAP_MODSEQ_INVALID'),
});

const withImapClient = async <T>(
  request: { credential: ImapBaselineRequest['credential'] },
  allowedHosts: string | undefined,
  operation: (client: ImapClient) => Promise<T>,
): Promise<T> => {
  try {
    const endpoint = await resolveMailEndpoint(request.credential.imap, allowedHosts);
    const module = await import('imapflow');
    const client = new module.ImapFlow({
      host: endpoint.address,
      port: endpoint.port,
      secure: endpoint.secure,
      doSTARTTLS: endpoint.secure ? undefined : true,
      auth: {
        user: request.credential.username,
        pass: request.credential.password,
      },
      logger: false,
      emitLogs: false,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      tls: {
        rejectUnauthorized: true,
        servername: isIP(endpoint.originalHost) === 0 ? endpoint.originalHost : undefined,
      },
    }) as unknown as ImapClient;
    client.on('error', () => undefined);
    try {
      await client.connect();
      return await operation(client);
    } finally {
      try {
        if (client.usable) await client.logout();
        else client.close();
      } catch {
        client.close();
      }
    }
  } catch (error) {
    throw classifyMailProtocolError(error, 'imap');
  }
};

const mapMessage = (message: ImapMessage) => {
  if (!Number.isSafeInteger(message.uid) || (message.uid ?? 0) < 1) {
    throw new MailProtocolOperationError('IMAP_MESSAGE_UID_MISSING', 'retryable');
  }
  const messageId = message.envelope?.messageId;
  return {
    uid: message.uid!,
    messageId:
      typeof messageId === 'string' && /^<[^\u0000-\u0020\u007f<>]+>$/u.test(messageId)
        ? messageId
        : null,
    receivedAt:
      message.internalDate instanceof Date && !Number.isNaN(message.internalDate.getTime())
        ? message.internalDate.toISOString()
        : null,
  };
};

const collectMessages = async (
  client: ImapClient,
  plan: ReturnType<typeof createImapScanPlan>,
  limit: number,
): Promise<ReturnType<typeof mapMessage>[]> => {
  if (plan.nextUid > plan.upperUid) return [];
  const range = `${plan.nextUid}:${plan.upperUid}`;
  if (plan.mode === 'recovery') {
    const matches = await client.search(
      { uid: range, since: new Date(plan.receivedSince!) },
      { uid: true },
    );
    const selected = matches
      .filter((uid) => uid >= plan.nextUid && uid <= plan.upperUid)
      .sort((left, right) => left - right)
      .slice(0, limit);
    if (selected.length === 0) return [];
    return (
      await client.fetchAll(
        selected.join(','),
        { uid: true, envelope: true, internalDate: true },
        { uid: true },
      )
    )
      .map(mapMessage)
      .sort((left, right) => left.uid - right.uid);
  }

  const messages: ReturnType<typeof mapMessage>[] = [];
  for await (const message of client.fetch(
    range,
    { uid: true, envelope: true, internalDate: true },
    { uid: true },
  )) {
    messages.push(mapMessage(message));
    if (messages.length >= limit) break;
  }
  return messages.sort((left, right) => left.uid - right.uid);
};

export const establishImapBaseline = async (
  request: ImapBaselineRequest,
  allowedHosts: string | undefined,
): Promise<ImapBaselineResponse> =>
  await withImapClient(request, allowedHosts, async (client) =>
    parseImapBaselineResponse(mailboxState(await client.mailboxOpen(request.mailbox))),
  );

export const discoverImapMessages = async (
  request: ImapDiscoverRequest,
  allowedHosts: string | undefined,
): Promise<ImapDiscoverResponse> =>
  await withImapClient(request, allowedHosts, async (client) => {
    const state = mailboxState(await client.mailboxOpen(request.mailbox));
    const plan = createImapScanPlan({
      actualUidValidity: state.uidValidity,
      actualUidNext: state.uidNext,
      expectedUidValidity: request.expectedUidValidity,
      nextUid: request.nextUid,
      lastSuccessfulAt: request.lastSuccessfulAt,
      cursor: request.cursor,
    });
    const messages = await collectMessages(client, plan, request.limit);
    return parseImapDiscoverResponse({
      ...state,
      scanUpperUid: plan.upperUid,
      reset: state.uidValidity !== request.expectedUidValidity,
      messages,
      nextCursor: nextImapPageCursor(
        plan,
        messages.map(({ uid }) => uid),
        request.limit,
      ),
    });
  });

export const fetchImapRawMessage = async (
  request: ImapRawRequest,
  allowedHosts: string | undefined,
): Promise<ImapRawResponse> =>
  await withImapClient(request, allowedHosts, async (client) => {
    const state = mailboxState(await client.mailboxOpen(request.mailbox));
    if (state.uidValidity !== request.uidValidity) {
      throw new MailProtocolOperationError('IMAP_UIDVALIDITY_CHANGED', 'permanent');
    }
    const message = await client.fetchOne(
      request.uid,
      { uid: true, source: true, internalDate: true },
      { uid: true },
    );
    if (message === false || message.source == null) {
      throw new MailProtocolOperationError('IMAP_MESSAGE_NOT_FOUND', 'permanent');
    }
    const source = new Uint8Array(message.source);
    if (source.byteLength === 0 || source.byteLength > MAX_RAW_MESSAGE_BYTES) {
      throw new MailProtocolOperationError('IMAP_MESSAGE_SIZE_INVALID', 'permanent');
    }
    return parseImapRawResponse({
      uidValidity: state.uidValidity,
      uid: request.uid,
      rawMimeBase64: Buffer.from(source).toString('base64'),
      receivedAt:
        message.internalDate instanceof Date && !Number.isNaN(message.internalDate.getTime())
          ? message.internalDate.toISOString()
          : null,
    });
  });
