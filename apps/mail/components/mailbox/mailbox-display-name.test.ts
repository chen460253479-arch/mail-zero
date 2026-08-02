import { describe, expect, it } from 'vitest';

import type { Mailbox } from '@/modules/mail/model/mailbox';

import { getMailboxDisplayName } from './mailbox-display-name';

const mailbox = (overrides: Partial<Mailbox>): Mailbox => ({
  id: 'mailbox',
  parentId: null,
  name: 'Mailbox',
  kind: 'system',
  role: null,
  color: null,
  sortOrder: 0,
  isSubscribed: true,
  totalEmails: 0,
  unreadEmails: 0,
  totalThreads: 0,
  unreadThreads: 0,
  ...overrides,
});

describe('getMailboxDisplayName', () => {
  it('uses the localized role name for a system mailbox', () => {
    expect(
      getMailboxDisplayName(mailbox({ name: 'Inbox', role: 'inbox' }), { inbox: '收件箱' }),
    ).toBe('收件箱');
  });

  it('preserves the user-defined name for a custom folder', () => {
    expect(
      getMailboxDisplayName(mailbox({ name: '客户', kind: 'folder', role: null }), {
        inbox: '收件箱',
      }),
    ).toBe('客户');
  });
});
