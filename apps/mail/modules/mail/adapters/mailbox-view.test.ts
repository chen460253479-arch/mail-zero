import { describe, expect, it } from 'vitest';

import { buildMailboxStats } from './mailbox-view';
import type { Mailbox } from '../model/mailbox';

const mailbox = (
  id: string,
  name: string,
  kind: Mailbox['kind'],
  parentId: string | null = null,
): Mailbox => ({
  id,
  parentId,
  name,
  kind,
  role: null,
  color: null,
  sortOrder: 0,
  isSubscribed: true,
  totalEmails: 0,
  unreadEmails: 0,
  totalThreads: 0,
  unreadThreads: 0,
});

describe('buildMailboxStats', () => {
  it('reports only role-appropriate non-zero badge counts', () => {
    expect(
      buildMailboxStats([
        {
          ...mailbox('mailbox-inbox', 'Inbox', 'system'),
          role: 'inbox',
          totalEmails: 5,
          totalThreads: 5,
          unreadEmails: 2,
          unreadThreads: 2,
        },
        { ...mailbox('mailbox-sent', 'Sent', 'system'), role: 'sent', totalThreads: 8 },
      ]),
    ).toEqual([
      { label: 'inbox', mailboxId: 'mailbox-inbox', count: 2 },
      { label: 'sent', mailboxId: 'mailbox-sent', count: 8 },
    ]);
  });
});
