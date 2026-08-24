import type { EnqueueMailNotification, MailNotificationRepository } from '@zero/mail-core';

type ClaimedMailNotificationBase = {
  eventId: string;
  accountId: string;
  attempts: number;
  leaseOwner: string;
};

export type ClaimedMailNotification = ClaimedMailNotificationBase &
  (
    | {
        eventType: 'message';
        messageId: string;
        kind: 'received' | 'sent';
        createCustomerIfMissing: boolean;
      }
    | {
        eventType: 'submission_status';
        externalSubmissionId: string;
        messageId: string | null;
        kind: 'sent' | 'failed';
        occurredAt: Date;
        sentAt: Date | null;
        errorCode: string | null;
        errorMessage: string | null;
      }
  );

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
