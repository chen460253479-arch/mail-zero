import { fromByteArray } from 'base64-js';

import type {
  FrozenOutboundMessage,
  OutboundErrorClassification,
  OutboundMailAdapter,
} from '../../contracts';
import { MailProtocolWorkerError, type MailProtocolClient } from '../shared/protocol-client';

const validMessageId = (value: string): boolean =>
  value.length > 2 &&
  value.length <= 998 &&
  value.startsWith('<') &&
  value.endsWith('>') &&
  !/[\u0000-\u0020\u007f]/u.test(value);

const requireMessage = (input: FrozenOutboundMessage): void => {
  if (
    input.rawMime.byteLength === 0 ||
    input.rawMime.byteLength > 25 * 1024 * 1024 ||
    !validMessageId(input.messageId) ||
    input.envelope.from.length === 0 ||
    input.envelope.to.length + input.envelope.cc.length + input.envelope.bcc.length === 0
  ) {
    throw new MailProtocolWorkerError('SMTP_INVALID_REQUEST', 'permanent');
  }
};

const classify = (error: unknown): OutboundErrorClassification => {
  if (!(error instanceof MailProtocolWorkerError)) {
    return {
      kind: 'uncertain',
      providerCode: null,
      safeResponse: 'unknown_result',
      retryAfter: null,
    };
  }
  switch (error.classification) {
    case 'authentication':
      return {
        kind: 'authentication_required',
        providerCode: error.code,
        safeResponse: 'authentication_required',
        retryAfter: null,
      };
    case 'retryable':
      return {
        kind: 'temporary_failure',
        providerCode: error.code,
        safeResponse: 'temporary_failure',
        retryAfter: null,
      };
    case 'permanent':
      return {
        kind: 'permanent_failure',
        providerCode: error.code,
        safeResponse: 'permanent_failure',
        retryAfter: null,
      };
    case 'uncertain':
      return {
        kind: 'uncertain',
        providerCode: error.code,
        safeResponse: 'unknown_result',
        retryAfter: null,
      };
  }
};

export const createImapSmtpOutboundAdapter = (
  client: MailProtocolClient,
  clock: { now(): Date } = { now: () => new Date() },
): OutboundMailAdapter => ({
  provider: 'imap_smtp',

  send: async (input) => {
    requireMessage(input);
    const response = await client.sendSmtp({
      envelope: {
        from: input.envelope.from,
        to: [...input.envelope.to, ...input.envelope.cc, ...input.envelope.bcc],
      },
      rawMimeBase64: fromByteArray(input.rawMime),
      messageId: input.messageId,
    });
    return {
      remoteMessageId: input.messageId,
      remoteThreadId: null,
      acceptedAt: clock.now(),
      providerCode: String(response.responseCode),
      safeResponse: 'accepted',
    };
  },

  classifyError: classify,

  reconcile: async () => ({
    status: 'inconclusive',
    retryAfter: new Date(clock.now().getTime() + 5 * 60_000),
  }),
});
