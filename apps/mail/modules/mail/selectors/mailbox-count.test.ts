import { describe, expect, it } from 'vitest';

import type { Mailbox, MailboxRole } from '../model/mailbox';
import { mailboxBadgeCount } from './mailbox-count';

const mailbox = (
  kind: Mailbox['kind'],
  role: MailboxRole | null,
  totalThreads: number,
  unreadThreads: number,
): Mailbox => ({
  id: `${kind}-${role ?? 'custom'}`,
  parentId: null,
  name: role ?? kind,
  kind,
  role,
  color: null,
  sortOrder: 0,
  isSubscribed: true,
  totalEmails: totalThreads,
  unreadEmails: unreadThreads,
  totalThreads,
  unreadThreads,
});

describe('mailboxBadgeCount', () => {
  it('shows unread thread counts for Inbox, Junk, folders, and labels', () => {
    expect(mailboxBadgeCount(mailbox('system', 'inbox', 20, 3))).toBe(3);
    expect(mailboxBadgeCount(mailbox('system', 'junk', 8, 2))).toBe(2);
    expect(mailboxBadgeCount(mailbox('folder', null, 7, 4))).toBe(4);
    expect(mailboxBadgeCount(mailbox('label', null, 9, 5))).toBe(5);
  });

  it('shows total thread counts for Drafts and Sent and hides zero values', () => {
    expect(mailboxBadgeCount(mailbox('system', 'drafts', 6, 0))).toBe(6);
    expect(mailboxBadgeCount(mailbox('system', 'drafts', 0, 0))).toBeNull();
    expect(mailboxBadgeCount(mailbox('system', 'sent', 4, 1))).toBe(4);
    expect(mailboxBadgeCount(mailbox('system', 'sent', 0, 0))).toBeNull();
    expect(mailboxBadgeCount(mailbox('folder', null, 4, 0))).toBeNull();
  });

  it('does not show counts for Archive, Trash, or auxiliary system mailboxes', () => {
    expect(mailboxBadgeCount(mailbox('system', 'archive', 4, 1))).toBeNull();
    expect(mailboxBadgeCount(mailbox('system', 'trash', 4, 1))).toBeNull();
    expect(mailboxBadgeCount(mailbox('system', 'outbox', 4, 1))).toBeNull();
  });
});
