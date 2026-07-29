import {
  MailSyncError,
  parseIngressScope,
  type InboundMailAdapter,
} from '../../../modules/mail-sync';
import type { ZohoMailClient, ZohoMailboxContext, ZohoMessageSummary } from '../shared/zoho-client';
import { createZohoMailSubscription, parseZohoMailSubscriptionTarget } from './subscription';
import { createZohoMailCheckpoint, parseZohoMailCheckpoint } from './checkpoint';
import { classifyZohoMailError } from '../shared/errors';
import { mapZohoMessages } from './message-mapper';

const PAGE_SIZE = 200;
const OVERLAP_MS = 120_000n;

type Cursor = {
  receivedTime: string;
  messageId: string;
};

type PageCursor = Cursor & {
  start: number;
};

const laterCursor = (left: Cursor, right: Cursor): Cursor => {
  const leftTime = BigInt(left.receivedTime);
  const rightTime = BigInt(right.receivedTime);
  if (leftTime !== rightTime) return rightTime > leftTime ? right : left;
  return right.messageId.localeCompare(left.messageId) > 0 ? right : left;
};

const encodePageCursor = (cursor: PageCursor): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const decodePageCursor = (value: string | null, checkpoint: Cursor): PageCursor => {
  if (value === null) return { start: 1, ...checkpoint };
  try {
    const standard = value.replace(/-/gu, '+').replace(/_/gu, '/');
    const padded = standard.padEnd(standard.length + ((4 - (standard.length % 4)) % 4), '=');
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<PageCursor>;
    if (
      Number.isSafeInteger(parsed.start) &&
      (parsed.start ?? 0) > 0 &&
      typeof parsed.receivedTime === 'string' &&
      /^\d+$/u.test(parsed.receivedTime) &&
      typeof parsed.messageId === 'string'
    ) {
      return parsed as PageCursor;
    }
  } catch {
    // One stable provider-state error is returned below.
  }
  throw new MailSyncError('ZOHO_INVALID_PAGE_CURSOR', 'permanent');
};

const selectOverlap = (
  messages: readonly ZohoMessageSummary[],
  checkpoint: Cursor,
  baselineReceivedTime: string,
  inboxFolderId: string,
): { messages: ZohoMessageSummary[]; reachedBoundary: boolean } => {
  const checkpointTime = BigInt(checkpoint.receivedTime);
  const boundary = checkpointTime > OVERLAP_MS ? checkpointTime - OVERLAP_MS : 0n;
  const baseline = BigInt(baselineReceivedTime);
  const selected: ZohoMessageSummary[] = [];
  for (const message of messages) {
    if (!/^\d+$/u.test(message.receivedTime)) continue;
    const receivedTime = BigInt(message.receivedTime);
    if (receivedTime < boundary) {
      return { messages: selected, reachedBoundary: true };
    }
    if (receivedTime <= baseline || message.folderId !== inboxFolderId) continue;
    selected.push(message);
  }
  return { messages: selected, reachedBoundary: false };
};

export const createZohoMailIngressAdapter = (
  client: ZohoMailClient,
  mailbox: ZohoMailboxContext,
  clock: { now(): Date } = { now: () => new Date() },
): InboundMailAdapter => ({
  provider: 'zoho_mail',

  establishCheckpoint: async (scope) => {
    parseIngressScope(scope);
    const baselineAt = clock.now();
    return createZohoMailCheckpoint({
      accountId: mailbox.accountId,
      inboxFolderId: mailbox.inboxFolderId,
      receivedTime: String(baselineAt.getTime()),
      messageId: '\uffff',
      baselineReceivedTime: String(baselineAt.getTime()),
      lastSuccessfulAt: baselineAt,
    });
  },

  discover: async ({ scope, checkpoint, pageToken }) => {
    parseIngressScope(scope);
    const state = parseZohoMailCheckpoint(checkpoint);
    if (state.accountId !== mailbox.accountId || state.inboxFolderId !== mailbox.inboxFolderId) {
      throw new MailSyncError('ZOHO_MAILBOX_CONTEXT_CHANGED', 'permanent');
    }
    const pageCursor = decodePageCursor(pageToken, state);
    const messages = await client.listInboxMessages({
      accountId: state.accountId,
      inboxFolderId: state.inboxFolderId,
      start: pageCursor.start,
      limit: PAGE_SIZE,
    });
    const overlap = selectOverlap(messages, state, state.baselineReceivedTime, state.inboxFolderId);
    const maximum = overlap.messages.reduce<Cursor>(
      (current, message) =>
        laterCursor(current, {
          receivedTime: message.receivedTime,
          messageId: message.messageId,
        }),
      {
        receivedTime: pageCursor.receivedTime,
        messageId: pageCursor.messageId,
      },
    );
    const finished = overlap.reachedBoundary || messages.length < PAGE_SIZE;
    return {
      events: mapZohoMessages(overlap.messages),
      nextPageToken: finished
        ? null
        : encodePageCursor({
            start: pageCursor.start + messages.length,
            ...maximum,
          }),
      checkpoint: finished
        ? createZohoMailCheckpoint({
            accountId: state.accountId,
            inboxFolderId: state.inboxFolderId,
            ...maximum,
            baselineReceivedTime: state.baselineReceivedTime,
            lastSuccessfulAt: clock.now(),
          })
        : state,
    };
  },

  fetchRawMessage: async ({ scope, remoteMessageId }) => {
    parseIngressScope(scope);
    return {
      remoteMessageId,
      raw: await client.getOriginalMessage({
        accountId: mailbox.accountId,
        inboxFolderId: mailbox.inboxFolderId,
        messageId: remoteMessageId,
      }),
      receivedAt: null,
    };
  },

  subscribe: async ({ scope, checkpoint, target }) => {
    parseIngressScope(scope);
    parseZohoMailCheckpoint(checkpoint);
    return createZohoMailSubscription(parseZohoMailSubscriptionTarget(target));
  },

  classifyError: classifyZohoMailError,
});
