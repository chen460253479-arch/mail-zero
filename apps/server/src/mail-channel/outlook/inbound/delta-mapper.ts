import type { IngressMessageAdded } from '../../../modules/mail-sync';
import type { OutlookDeltaMessage } from '../shared/graph-client';

export const mapOutlookDeltaMessages = (
  messages: readonly OutlookDeltaMessage[],
): IngressMessageAdded[] => {
  const events = new Map<string, IngressMessageAdded>();
  for (const message of messages) {
    if (!message.id || message['@removed'] !== undefined || events.has(message.id)) continue;
    events.set(message.id, {
      type: 'message_added',
      remoteMessageId: message.id,
      remoteThreadId: message.conversationId ?? null,
    });
  }
  return [...events.values()];
};
