import { describe, expect, it } from 'vitest';

import {
  allowedDeliveryTransitions,
  recoverExpiredLease,
  transitionDelivery,
} from '../../../../../src/modules/mail-outbound/domain/state-machine';
import type { OutboundDeliveryRecord, OutboundDeliveryStatus } from '../../../../../src/modules/mail-outbound/domain/delivery';

const now = new Date('2026-07-26T12:00:00.000Z');

const delivery = (
  status: OutboundDeliveryStatus,
  patch: Partial<OutboundDeliveryRecord> = {},
): OutboundDeliveryRecord => ({
  id: 'delivery-1',
  mailAccountId: 'account-1',
  submissionId: 'submission-1',
  connectionId: 'connection-1',
  status,
  availableAt: new Date('2026-07-26T11:00:00.000Z'),
  leaseOwner: status === 'leased' ? 'worker-1' : null,
  leaseToken: status === 'leased' ? 'lease-1' : null,
  leaseExpiresAt: status === 'leased' ? new Date('2026-07-26T11:59:00.000Z') : null,
  attemptCount: 1,
  reconciliationCount: 0,
  uncertainSince: null,
  lastErrorKind: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  createdAt: new Date('2026-07-26T11:00:00.000Z'),
  updatedAt: new Date('2026-07-26T11:00:00.000Z'),
  completedAt: null,
  ...patch,
});

describe('outbound delivery state machine', () => {
  it.each([
    ['scheduled', 'ready'],
    ['scheduled', 'canceled'],
    ['ready', 'leased'],
    ['ready', 'canceled'],
    ['leased', 'retry_wait'],
    ['leased', 'uncertain'],
    ['leased', 'completed'],
    ['leased', 'failed'],
    ['retry_wait', 'leased'],
    ['retry_wait', 'canceled'],
    ['uncertain', 'leased'],
  ] satisfies [OutboundDeliveryStatus, OutboundDeliveryStatus][])(
    'accepts the approved %s -> %s transition',
    (from, to) => {
      expect(transitionDelivery(delivery(from), to, now)).toMatchObject({
        status: to,
        updatedAt: now,
      });
    },
  );

  it('rejects transitions that bypass the durable lifecycle', () => {
    expect(() => transitionDelivery(delivery('scheduled'), 'leased', now)).toThrowError(
      expect.objectContaining({ code: 'INVALID_DELIVERY_TRANSITION' }),
    );
    expect(() => transitionDelivery(delivery('leased'), 'ready', now)).toThrowError(
      expect.objectContaining({ code: 'INVALID_DELIVERY_TRANSITION' }),
    );
    expect(allowedDeliveryTransitions.leased).not.toContain('ready');
  });

  it.each(['completed', 'failed', 'canceled'] satisfies OutboundDeliveryStatus[])(
    'keeps %s terminal',
    (status) => {
      for (const candidate of Object.keys(allowedDeliveryTransitions) as OutboundDeliveryStatus[]) {
        expect(() => transitionDelivery(delivery(status), candidate, now)).toThrowError(
          expect.objectContaining({ code: 'INVALID_DELIVERY_TRANSITION' }),
        );
      }
    },
  );

  it('moves an expired lease to uncertain and clears ownership instead of making it ready', () => {
    const recovered = recoverExpiredLease(delivery('leased'), now);

    expect(recovered).toMatchObject({
      status: 'uncertain',
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      uncertainSince: now,
      availableAt: now,
      updatedAt: now,
    });
    expect(
      recoverExpiredLease(delivery('leased', { leaseExpiresAt: new Date(now.getTime() + 1) }), now),
    ).toBeNull();
    expect(recoverExpiredLease(delivery('ready'), now)).toBeNull();
  });
});
