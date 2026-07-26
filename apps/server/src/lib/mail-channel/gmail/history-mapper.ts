import type { IngressMessageAdded } from '../../../modules/mail-sync';

export type GmailHistoryMessage = {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
};

export type GmailHistoryRecord = {
  id?: string | null;
  messagesAdded?: Array<{ message?: GmailHistoryMessage | null }> | null;
  labelsAdded?: Array<{
    message?: GmailHistoryMessage | null;
    labelIds?: string[] | null;
  }> | null;
  labelsRemoved?: Array<{
    message?: GmailHistoryMessage | null;
    labelIds?: string[] | null;
  }> | null;
  messagesDeleted?: Array<{ message?: GmailHistoryMessage | null }> | null;
};

export const mapGmailHistoryPage = (
  history: readonly GmailHistoryRecord[],
): IngressMessageAdded[] => {
  const events = new Map<string, IngressMessageAdded>();
  for (const record of history) {
    for (const added of record.messagesAdded ?? []) {
      const message = added.message;
      if (!message?.id || !message.labelIds?.includes('INBOX') || events.has(message.id)) {
        continue;
      }
      events.set(message.id, {
        type: 'message_added',
        remoteMessageId: message.id,
        remoteThreadId: message.threadId ?? null,
      });
    }
  }
  return [...events.values()];
};
