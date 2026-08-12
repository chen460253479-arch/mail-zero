import type { EnqueueMailNotification, MailNotificationRepository } from '@zero/mail-core';

export type ClaimedMailNotification = {
  eventId: string;
  messageId: string;
  accountId: string;
  kind: 'received' | 'sent';
  createCustomerIfMissing: boolean;
  attempts: number;
  leaseOwner: string;
};

export type ClaimMailNotificationsInput = {
  owner: string;
  now: Date;
  limit: number;
  leaseForMs: number;
};

export interface MailNotificationOutboxRepository extends MailNotificationRepository {
  enqueue(input: EnqueueMailNotification): Promise<void>;
  claim(input: ClaimMailNotificationsInput): Promise<ClaimedMailNotification[]>;
  complete(input: { eventId: string; owner: string }): Promise<boolean>;
  scheduleRetry(input: {
    eventId: string;
    owner: string;
    now: Date;
    runAt: Date;
    errorMessage: string;
  }): Promise<'retry' | 'dead' | 'lost'>;
}
