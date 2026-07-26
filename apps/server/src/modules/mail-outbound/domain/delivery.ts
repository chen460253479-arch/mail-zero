import type { OutboundErrorKind } from '../../../mail-channel/contracts';

export const outboundDeliveryStatuses = [
  'scheduled',
  'ready',
  'leased',
  'retry_wait',
  'uncertain',
  'completed',
  'failed',
  'canceled',
] as const;

export type OutboundDeliveryStatus = (typeof outboundDeliveryStatuses)[number];
export type OutboundAttemptKind = 'send' | 'reconcile';
export type OutboundAttemptOutcome =
  | 'sent'
  | 'transient_failure'
  | 'permanent_failure'
  | 'uncertain'
  | 'not_found';

export type OutboundDeliveryRecord = {
  id: string;
  mailAccountId: string;
  submissionId: string;
  connectionId: string;
  status: OutboundDeliveryStatus;
  availableAt: Date;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
  reconciliationCount: number;
  uncertainSince: Date | null;
  lastErrorKind: OutboundErrorKind | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type LeaseIdentity = {
  deliveryId: string;
  leaseToken: string;
};

export type ClaimedDelivery = {
  delivery: OutboundDeliveryRecord & {
    status: 'leased';
    leaseOwner: string;
    leaseToken: string;
    leaseExpiresAt: Date;
  };
  attemptKind: OutboundAttemptKind;
  attemptNumber: number;
};
