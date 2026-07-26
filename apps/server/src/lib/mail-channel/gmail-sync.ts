import { z } from 'zod';

import { normalizeMailboxEmail } from '../../modules/mail-accounts/application/mailbox-identity';
import type { ChannelChange, ChannelChangeSet, ChannelSyncAdapter } from './sync-types';

type GmailMessage = {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
};

type GmailHistory = {
  messagesAdded?: { message?: GmailMessage }[] | null;
  messagesDeleted?: { message?: GmailMessage }[] | null;
  labelsAdded?: { message?: GmailMessage; labelIds?: string[] | null }[] | null;
  labelsRemoved?: { message?: GmailMessage; labelIds?: string[] | null }[] | null;
};

const gmailPushEventSchema = z.object({
  emailAddress: z.string().min(1),
  historyId: z.string().min(1),
});

const toChange = (
  message: GmailMessage | undefined,
  addedLabelIds: string[],
  removedLabelIds: string[],
  deleted = false,
): ChannelChange | null => {
  if (!message?.id || !message.threadId) return null;
  return {
    remoteMessageId: message.id,
    remoteThreadId: message.threadId,
    addedLabelIds,
    removedLabelIds,
    deleted,
  };
};

export const mapGmailHistory = (history: GmailHistory[], nextCursor: string): ChannelChangeSet => {
  const changes: ChannelChange[] = [];

  for (const item of history) {
    for (const entry of item.messagesAdded ?? []) {
      if (entry.message?.labelIds?.includes('DRAFT')) continue;
      const change = toChange(entry.message, entry.message?.labelIds ?? [], []);
      if (change) changes.push(change);
    }
    for (const entry of item.messagesDeleted ?? []) {
      const change = toChange(entry.message, [], [], true);
      if (change) changes.push(change);
    }
    for (const entry of item.labelsAdded ?? []) {
      const change = toChange(entry.message, entry.labelIds ?? [], []);
      if (change) changes.push(change);
    }
    for (const entry of item.labelsRemoved ?? []) {
      const change = toChange(entry.message, [], entry.labelIds ?? []);
      if (change) changes.push(change);
    }
  }

  return { changes, nextCursor };
};

export const gmailSyncAdapter: ChannelSyncAdapter = {
  parsePushEvent(payload) {
    const event = gmailPushEventSchema.parse(payload);
    return {
      mailbox: normalizeMailboxEmail(event.emailAddress),
      cursor: event.historyId,
    };
  },
};
