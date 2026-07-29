import { toByteArray } from 'base64-js';

import {
  createImapCheckpoint,
  parseImapCheckpoint,
  parseImapRemoteMessageId,
  toImapRemoteMessageId,
} from './checkpoint';
import {
  MailSyncError,
  parseIngressScope,
  type InboundMailAdapter,
} from '../../../modules/mail-sync';
import { imapPageCursorSchema, type ImapPageCursor } from '../../../protocol-worker/contracts';
import { MailProtocolWorkerError, type MailProtocolClient } from '../shared/protocol-client';

const PAGE_SIZE = 100;

const encodePageToken = (cursor: ImapPageCursor): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const decodePageToken = (value: string | null): ImapPageCursor | null => {
  if (value === null) return null;
  try {
    const standard = value.replace(/-/gu, '+').replace(/_/gu, '/');
    const padded = standard.padEnd(standard.length + ((4 - (standard.length % 4)) % 4), '=');
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    return imapPageCursorSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new MailSyncError('IMAP_INVALID_PAGE_CURSOR', 'permanent');
  }
};

export const createImapSmtpIngressAdapter = (
  client: MailProtocolClient,
  clock: { now(): Date } = { now: () => new Date() },
): InboundMailAdapter => ({
  provider: 'imap_smtp',

  establishCheckpoint: async (scope) => {
    parseIngressScope(scope);
    const baseline = await client.establishImapBaseline();
    return createImapCheckpoint({
      uidValidity: baseline.uidValidity,
      nextUid: baseline.uidNext,
      highestModseq: baseline.highestModseq,
      lastSuccessfulAt: clock.now(),
    });
  },

  discover: async ({ scope, checkpoint, pageToken }) => {
    parseIngressScope(scope);
    const state = parseImapCheckpoint(checkpoint);
    const page = await client.discoverImap({
      expectedUidValidity: state.uidValidity,
      nextUid: state.nextUid,
      lastSuccessfulAt: state.lastSuccessfulAt,
      cursor: decodePageToken(pageToken),
      limit: PAGE_SIZE,
    });
    if (!page.reset && page.uidValidity !== state.uidValidity) {
      throw new MailSyncError('IMAP_UIDVALIDITY_CHANGED_WITHOUT_RESET', 'permanent');
    }
    const events = [
      ...new Map(
        page.messages.map((message) => {
          const remoteMessageId = toImapRemoteMessageId(page.uidValidity, message.uid);
          return [
            remoteMessageId,
            {
              type: 'message_added' as const,
              remoteMessageId,
              remoteThreadId: null,
            },
          ] as const;
        }),
      ).values(),
    ];
    return {
      events,
      nextPageToken: page.nextCursor === null ? null : encodePageToken(page.nextCursor),
      checkpoint:
        page.nextCursor === null
          ? createImapCheckpoint({
              uidValidity: page.uidValidity,
              nextUid: Math.max(1, page.scanUpperUid + 1),
              highestModseq: page.highestModseq,
              lastSuccessfulAt: clock.now(),
            })
          : state,
    };
  },

  fetchRawMessage: async ({ scope, remoteMessageId }) => {
    parseIngressScope(scope);
    const remote = parseImapRemoteMessageId(remoteMessageId);
    const response = await client.fetchImapRaw(remote);
    if (response.uidValidity !== remote.uidValidity || response.uid !== remote.uid) {
      throw new MailSyncError('IMAP_RAW_MESSAGE_ID_MISMATCH', 'permanent');
    }
    return {
      remoteMessageId,
      raw: toByteArray(response.rawMimeBase64),
      receivedAt: response.receivedAt === null ? null : new Date(response.receivedAt),
    };
  },

  classifyError: (error) =>
    error instanceof MailProtocolWorkerError
      ? error.classification === 'uncertain'
        ? 'retryable'
        : error.classification
      : 'retryable',
});
