import type { FrozenOutboundMessage, OutboundMailAdapter } from '../../contracts';
import { classifyGmailOutboundError, GmailOutboundError } from './errors';
import { addTransientBccHeader } from '../../shared/outbound-mime';
import type { GmailApiClient } from '../shared/api-client';
import { requireGmailMessageId } from './result-mapper';

const validMessageId = (value: string): boolean =>
  value.length > 2 &&
  value.length <= 998 &&
  value.startsWith('<') &&
  value.endsWith('>') &&
  !/[\u0000-\u0020\u007f]/u.test(value);

const requireOutboundMessage = (input: FrozenOutboundMessage): void => {
  if (
    input.rawMime.byteLength === 0 ||
    !validMessageId(input.messageId) ||
    input.envelope.from.length === 0 ||
    input.envelope.to.length + input.envelope.cc.length + input.envelope.bcc.length === 0
  ) {
    throw new GmailOutboundError('GMAIL_INVALID_REQUEST');
  }
};

export const createGmailOutboundAdapter = (
  client: GmailApiClient,
  clock: { now(): Date },
): OutboundMailAdapter => ({
  provider: 'gmail',
  send: async (input) => {
    requireOutboundMessage(input);
    const response = await client.sendRawMessage({
      raw: addTransientBccHeader(input.rawMime, input.envelope.bcc),
      remoteThreadId: input.remoteThreadId,
    });
    return {
      remoteMessageId: requireGmailMessageId(response.id),
      remoteThreadId: response.threadId,
      acceptedAt: clock.now(),
      providerCode: null,
      safeResponse: 'accepted',
    };
  },
  classifyError: (error) => classifyGmailOutboundError(error, clock.now()),
  reconcile: async (input) => {
    if (!validMessageId(input.messageId)) {
      throw new GmailOutboundError('GMAIL_INVALID_REQUEST');
    }
    const matches = await client.findSentByMessageId(input.messageId);
    if (matches.length === 0) {
      return { status: 'not_found' };
    }
    const selected = [...matches].sort((left, right) => {
      const leftDate = Number(left.internalDate);
      const rightDate = Number(right.internalDate);
      const leftValue = Number.isFinite(leftDate) ? leftDate : Number.MAX_SAFE_INTEGER;
      const rightValue = Number.isFinite(rightDate) ? rightDate : Number.MAX_SAFE_INTEGER;
      return leftValue - rightValue || left.id.localeCompare(right.id);
    })[0]!;
    const parsedAcceptedAt = Number(selected.internalDate);
    return {
      status: 'found',
      result: {
        remoteMessageId: selected.id,
        remoteThreadId: selected.threadId,
        acceptedAt: Number.isFinite(parsedAcceptedAt) ? new Date(parsedAcceptedAt) : clock.now(),
        providerCode: null,
        safeResponse: 'accepted',
      },
    };
  },
});
