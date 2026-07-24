import { describe, expect, it } from 'vitest';

import { resolveGmailConnectMode } from './gmail-connection-options';

describe('resolveGmailConnectMode', () => {
  it.each([
    [true, true, 'choice'],
    [true, false, 'zero_oauth'],
    [false, true, 'nango'],
    [false, false, 'unavailable'],
  ] as const)(
    'resolves Zero OAuth=%s and Nango=%s to %s',
    (zeroOAuthAvailable, nangoAvailable, expected) => {
      expect(resolveGmailConnectMode({ zeroOAuthAvailable, nangoAvailable })).toBe(expected);
    },
  );
});
