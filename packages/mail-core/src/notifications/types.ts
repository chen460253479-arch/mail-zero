import type { EmailId, MailAccountId } from '../types';

export type MailNotificationKind = 'received' | 'sent';

export type EnqueueMailNotification = {
  eventId: string;
  messageId: EmailId;
  accountId: MailAccountId;
  kind: MailNotificationKind;
  createdAt: Date;
};

export interface MailNotificationRepository {
  enqueue(input: EnqueueMailNotification): Promise<void>;
}
