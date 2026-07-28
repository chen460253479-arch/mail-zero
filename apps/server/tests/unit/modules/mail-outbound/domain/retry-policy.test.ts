import { describe, expect, it } from 'vitest';

import {
  MAX_PROVIDER_RETRY_AFTER_MS,
  nextOutboundRetryAt,
  RECONCILIATION_DELAYS_MS,
  SEND_RETRY_DELAYS_MS,
} from '../../../../../src/modules/mail-outbound/domain/retry-policy';

const now = new Date('2026-07-26T12:00:00.000Z');

describe('mail outbound retry policy', () => {
  it('uses the explicit send and reconciliation schedules and stops when exhausted', () => {
    expect(SEND_RETRY_DELAYS_MS).toEqual([30_000, 120_000, 600_000, 1_800_000, 7_200_000]);
    expect(RECONCILIATION_DELAYS_MS).toEqual([30_000, 120_000, 600_000]);
    expect(
      nextOutboundRetryAt({
        now,
        attemptNumber: 1,
        kind: 'send',
        providerRetryAfter: null,
        jitter: () => 0,
      }),
    ).toEqual(new Date('2026-07-26T12:00:30.000Z'));
    expect(
      nextOutboundRetryAt({
        now,
        attemptNumber: 2,
        kind: 'reconcile',
        providerRetryAfter: null,
        jitter: () => 0,
      }),
    ).toEqual(new Date('2026-07-26T12:02:00.000Z'));
    expect(
      nextOutboundRetryAt({
        now,
        attemptNumber: 6,
        kind: 'send',
        providerRetryAfter: null,
        jitter: () => 0,
      }),
    ).toBeNull();
  });

  it('applies at most twenty percent deterministic jitter', () => {
    expect(
      nextOutboundRetryAt({
        now,
        attemptNumber: 1,
        kind: 'send',
        providerRetryAfter: null,
        jitter: () => 1,
      }),
    ).toEqual(new Date('2026-07-26T12:00:36.000Z'));
    expect(
      nextOutboundRetryAt({
        now,
        attemptNumber: 1,
        kind: 'send',
        providerRetryAfter: null,
        jitter: () => -1,
      }),
    ).toEqual(new Date('2026-07-26T12:00:24.000Z'));
    expect(
      nextOutboundRetryAt({
        now,
        attemptNumber: 1,
        kind: 'send',
        providerRetryAfter: null,
        jitter: () => 50,
      }),
    ).toEqual(new Date('2026-07-26T12:00:36.000Z'));
    expect(
      nextOutboundRetryAt({
        now,
        attemptNumber: 1,
        kind: 'send',
        providerRetryAfter: null,
        jitter: () => Number.NaN,
      }),
    ).toEqual(new Date('2026-07-26T12:00:30.000Z'));
  });

  it('uses only a finite future Provider Retry-After inside the safety bound', () => {
    expect(
      nextOutboundRetryAt({
        now,
        attemptNumber: 1,
        kind: 'send',
        providerRetryAfter: new Date('2026-07-26T12:10:00.000Z'),
        jitter: () => 0,
      }),
    ).toEqual(new Date('2026-07-26T12:10:00.000Z'));
    for (const invalid of [
      new Date('invalid'),
      new Date('2026-07-26T11:59:59.999Z'),
      new Date(now.getTime() + MAX_PROVIDER_RETRY_AFTER_MS + 1),
    ]) {
      expect(
        nextOutboundRetryAt({
          now,
          attemptNumber: 1,
          kind: 'send',
          providerRetryAfter: invalid,
          jitter: () => 0,
        }),
      ).toEqual(new Date('2026-07-26T12:00:30.000Z'));
    }
  });
});
