import { classifyZohoMailOutboundError, ZohoMailApiError } from '../shared/errors';
import type { FrozenOutboundMessage, OutboundMailAdapter } from '../../contracts';
import type { ZohoMailClient, ZohoMailboxContext } from '../shared/zoho-client';
import { projectFrozenMimeForZoho } from './mime-projection';

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
    throw new ZohoMailApiError('ZOHO_INVALID_REQUEST');
  }
};

export const createZohoMailOutboundAdapter = (
  client: ZohoMailClient,
  mailbox: ZohoMailboxContext,
  clock: { now(): Date } = { now: () => new Date() },
): OutboundMailAdapter => ({
  provider: 'zoho_mail',

  send: async (input) => {
    validateMessage(input);
    const projection = await projectFrozenMimeForZoho(input.rawMime);
    const baseBody: Record<string, unknown> = {
      fromAddress: mailbox.email,
      toAddress: input.envelope.to.join(','),
      ...(input.envelope.cc.length === 0 ? {} : { ccAddress: input.envelope.cc.join(',') }),
      ...(input.envelope.bcc.length === 0 ? {} : { bccAddress: input.envelope.bcc.join(',') }),
      subject: projection.subject,
      content: projection.content,
      mailFormat: projection.mailFormat,
    };

    let result: { messageId: string; mailId: string | null };
    if (input.remoteParentMessageId) {
      if (projection.attachments.length > 0) {
        throw new ZohoMailApiError('ZOHO_REPLY_ATTACHMENTS_UNSUPPORTED');
      }
      result = await client.replyToMessage({
        accountId: mailbox.accountId,
        parentMessageId: input.remoteParentMessageId,
        body: {
          fromAddress: mailbox.email,
          toAddress: input.envelope.to.join(','),
          action: 'reply',
          content: projection.content,
        },
      });
    } else {
      const attachments = await Promise.all(
        projection.attachments.map(
          async ({ filename, bytes }) =>
            await client.uploadAttachment({
              accountId: mailbox.accountId,
              filename,
              bytes,
            }),
        ),
      );
      result = await client.sendMessage({
        accountId: mailbox.accountId,
        body: {
          ...baseBody,
          ...(attachments.length === 0 ? {} : { attachments }),
        },
      });
    }
    return {
      remoteMessageId: result.messageId,
      remoteThreadId: result.mailId,
      acceptedAt: clock.now(),
      providerCode: '200',
      safeResponse: 'accepted',
    };
  },

  classifyError: (error) => classifyZohoMailOutboundError(error, clock.now()),

  reconcile: async () => ({
    status: 'inconclusive',
    retryAfter: new Date(clock.now().getTime() + 5 * 60_000),
  }),
});
