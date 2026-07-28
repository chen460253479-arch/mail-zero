import { describe, expect, it } from 'vitest';

import { normalizeMailboxEmail } from '../../../../../src/modules/mail-accounts/application/mailbox-identity';

describe('normalize mailbox email', () => {
  it('normalizes case and whitespace only', () => {
    expect(normalizeMailboxEmail('  User.Name+tag@GMAIL.com ')).toBe('user.name+tag@gmail.com');
  });

  it('rejects an empty mailbox identity', () => {
    expect(() => normalizeMailboxEmail('   ')).toThrow('Mailbox email is required');
  });
});
