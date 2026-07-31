import type { FrozenOutboundMessage, OutboundMailAdapter } from '../../contracts';
import { classifyOutlookOutboundError, OutlookApiError } from '../shared/errors';
import { addTransientBccHeader } from '../../shared/outbound-mime';
import type { MicrosoftGraphClient } from '../shared/graph-client';

const validMessageId = (value: string): boolean =>
  value.length > 2 &&
  value.length <= 998 &&
  value.startsWith('<') &&
  value.endsWith('>') &&
  !/[\u0000-\u0020\u007f]/u.test(value);

const validateMessage = (input: FrozenOutboundMessage): void => {
  if (
    input.rawMime.byteLength === 0 ||
    !validMessageId(input.messageId) ||
    input.envelope.from.length === 0 ||
    input.envelope.to.length + input.envelope.cc.length + input.envelope.bcc.length === 0
  ) {
    throw new OutlookApiError('OUTLOOK_INVALID_REQUEST');
  }
};

const parseDate = (value: string | null, fallback: Date): Date => {
  if (value === null) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

export const createOutlookOutboundAdapter = (
  client: MicrosoftGraphClient,
  clock: { now(): Date } = { now: () => new Date() },
): OutboundMailAdapter => ({
  provider: 'outlook',

  send: async (input) => {
    validateMessage(input);
    const draft = await client.createMimeDraft(
      addTransientBccHeader(input.rawMime, input.envelope.bcc),
    );
    await client.sendDraft(draft.id);
    return {
      remoteMessageId: draft.id,
      remoteThreadId: draft.conversationId,
      acceptedAt: clock.now(),
      providerCode: '202',
      safeResponse: 'accepted',
    };
  },

  classifyError: (error) => classifyOutlookOutboundError(error, clock.now()),

  reconcile: async (input) => {
    if (!validMessageId(input.messageId)) {
      throw new OutlookApiError('OUTLOOK_INVALID_REQUEST');
    }
    const matches = await client.findSentByMessageId(input.messageId);
    if (matches.length === 0) return { status: 'not_found' };
    const selected = [...matches].sort((left, right) => {
      const leftTime = parseDate(left.sentDateTime, new Date(8_640_000_000_000_000)).getTime();
      const rightTime = parseDate(right.sentDateTime, new Date(8_640_000_000_000_000)).getTime();
      return leftTime - rightTime || left.id.localeCompare(right.id);
    })[0]!;
    return {
      status: 'found',
      result: {
        remoteMessageId: selected.id,
        remoteThreadId: selected.conversationId,
        acceptedAt: parseDate(selected.sentDateTime, clock.now()),
        providerCode: 'reconciled',
        safeResponse: 'accepted',
      },
    };
  },
});
