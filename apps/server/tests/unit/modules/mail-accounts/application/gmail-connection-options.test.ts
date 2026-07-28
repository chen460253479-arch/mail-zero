import { describe, expect, it } from 'vitest';

import { resolveGmailConnectMode } from '../../../../../src/modules/mail-accounts/application/gmail-connection-options';

describe('resolveGmailConnectMode', () => {
  it.each([
    ['zero_oauth', true, true, 'zero_oauth'],
    ['zero_oauth', false, true, 'unavailable'],
    ['nango', true, true, 'nango'],
    ['nango', true, false, 'unavailable'],
    [null, true, true, 'unavailable'],
  ] as const)(
    'routes selected source=%s with Zero OAuth=%s and Nango=%s to %s',
    (selectedAuthSource, zeroOAuthAvailable, nangoAvailable, expected) => {
      expect(
        resolveGmailConnectMode({
          selectedAuthSource,
          zeroOAuthAvailable,
          nangoAvailable,
        }),
      ).toBe(expected);
    },
  );
});
