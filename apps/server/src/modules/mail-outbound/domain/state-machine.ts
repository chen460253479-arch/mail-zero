import type { OutboundDeliveryRecord, OutboundDeliveryStatus } from './delivery';
import { MailOutboundError } from './errors';

export const allowedDeliveryTransitions = {
  scheduled: ['ready', 'canceled'],
  ready: ['leased', 'canceled'],
  leased: ['retry_wait', 'uncertain', 'completed', 'failed'],
  retry_wait: ['leased', 'canceled'],
  uncertain: ['leased'],
  completed: [],
  failed: [],
  canceled: [],
} as const satisfies Record<OutboundDeliveryStatus, readonly OutboundDeliveryStatus[]>;

export const transitionDelivery = (
  delivery: OutboundDeliveryRecord,
  to: OutboundDeliveryStatus,
  now: Date,
): OutboundDeliveryRecord => {
  if (
    !(allowedDeliveryTransitions[delivery.status] as readonly OutboundDeliveryStatus[]).includes(to)
  ) {
    throw new MailOutboundError('INVALID_DELIVERY_TRANSITION', 'permanent', delivery.id);
  }
  return { ...delivery, status: to, updatedAt: new Date(now) };
};

export const recoverExpiredLease = (
  delivery: OutboundDeliveryRecord,
  now: Date,
): OutboundDeliveryRecord | null => {
  if (
    delivery.status !== 'leased' ||
    delivery.leaseExpiresAt === null ||
    delivery.leaseExpiresAt.getTime() > now.getTime()
  ) {
    return null;
  }
  return {
    ...transitionDelivery(delivery, 'uncertain', now),
    availableAt: new Date(now),
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    uncertainSince: delivery.uncertainSince ?? new Date(now),
  };
};
