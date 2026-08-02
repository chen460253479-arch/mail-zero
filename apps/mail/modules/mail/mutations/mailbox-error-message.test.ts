import { describe, expect, it } from 'vitest';

import { mailboxErrorMessage } from './mailbox-error-message';

describe('mailboxErrorMessage', () => {
  it.each([
    ['MAILBOX_HAS_CHILD', 'This item still has children. Move or delete them first.'],
    ['MAILBOX_HAS_EMAIL', 'This folder still contains mail. Move or remove it first.'],
    ['MAILBOX_ROLE_CONFLICT', 'System mailboxes cannot be changed or deleted.'],
    ['MAILBOX_NAME_CONFLICT', 'An item with this name already exists at this level.'],
    ['STATE_MISMATCH', 'Mailbox content changed. Refresh and try again.'],
  ])('maps %s through the active message catalog', (code, expected) => {
    expect(mailboxErrorMessage(code)).toBe(expected);
  });

  it('uses a safe fallback for unknown errors', () => {
    expect(mailboxErrorMessage('UNKNOWN')).toBe('The mailbox operation failed. Try again.');
  });
});
