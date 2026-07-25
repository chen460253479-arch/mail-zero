import { describe, expect, it } from 'vitest';

import { calculateRetryAt } from '../../src';

describe('calculateRetryAt', () => {
  it.each([
    [1, '2026-01-01T00:00:30.000Z'],
    [2, '2026-01-01T00:02:00.000Z'],
    [3, '2026-01-01T00:10:00.000Z'],
    [4, '2026-01-01T00:30:00.000Z'],
    [5, '2026-01-01T02:00:00.000Z'],
  ])('uses the exact delay for attempt %i', (attemptNumber, expected) => {
    expect(
      calculateRetryAt(new Date('2026-01-01T00:00:00.000Z'), attemptNumber)?.toISOString(),
    ).toBe(expected);
  });

  it('makes attempt six permanent', () => {
    expect(calculateRetryAt(new Date('2026-01-01T00:00:00.000Z'), 6)).toBeNull();
  });

  it.each([0, -1, 1.5, 7, Number.NaN])('rejects invalid attempt number %s', (attemptNumber) => {
    expect(() => calculateRetryAt(new Date('2026-01-01T00:00:00.000Z'), attemptNumber)).toThrow(
      'INVALID_ATTEMPT_NUMBER',
    );
  });

  it('rejects an invalid current time', () => {
    expect(() => calculateRetryAt(new Date(Number.NaN), 1)).toThrow('INVALID_RETRY_TIME');
  });
});
