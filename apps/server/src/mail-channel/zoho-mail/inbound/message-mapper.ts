import type { IngressMessageAdded } from '../../../modules/mail-sync';
import type { ZohoMessageSummary } from '../shared/zoho-client';

export const mapZohoMessages = (messages: readonly ZohoMessageSummary[]): IngressMessageAdded[] => {
  const events = new Map<string, IngressMessageAdded>();
  for (const message of messages) {
    if (events.has(message.messageId)) continue;
    events.set(message.messageId, {
      type: 'message_added',
      remoteMessageId: message.messageId,
      remoteThreadId: message.threadId,
    });
  }
  return [...events.values()];
};
