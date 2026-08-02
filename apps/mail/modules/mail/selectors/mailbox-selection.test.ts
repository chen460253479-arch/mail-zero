import { describe, expect, it } from 'vitest';

import type { Mailbox, MailboxRole } from '../model/mailbox';
import { labelSelectionState, resolvePrimaryMailboxIds } from './mailbox-selection';

const mailbox = (
  id: string,
  kind: Mailbox['kind'],
  role: MailboxRole | null = null,
): Mailbox => ({
  id,
  parentId: null,
  name: id,
  kind,
  role,
  color: null,
  sortOrder: 0,
  isSubscribed: true,
  totalEmails: 0,
  unreadEmails: 0,
  totalThreads: 0,
  unreadThreads: 0,
});

describe('resolvePrimaryMailboxIds', () => {
  it('returns only organizational system mailboxes and custom folders', () => {
    const mailboxes = [
      mailbox('inbox', 'system', 'inbox'),
      mailbox('sent', 'system', 'sent'),
      mailbox('drafts', 'system', 'drafts'),
      mailbox('folder', 'folder'),
      mailbox('label', 'label'),
    ];

    expect(
      resolvePrimaryMailboxIds(mailboxes, ['label', 'sent', 'folder', 'inbox', 'drafts']),
    ).toEqual(['folder', 'inbox']);
  });
});

describe('labelSelectionState', () => {
  it('returns all, partial, and none for batch thread label membership', () => {
    expect(labelSelectionState('label-a', [['label-a'], ['inbox', 'label-a']])).toBe('all');
    expect(labelSelectionState('label-a', [['label-a'], ['inbox']])).toBe('partial');
    expect(labelSelectionState('label-a', [['inbox'], ['folder']])).toBe('none');
    expect(labelSelectionState('label-a', [])).toBe('none');
  });

  it('deduplicates mailbox IDs within a thread without changing the result', () => {
    expect(labelSelectionState('label-a', [['label-a', 'label-a'], ['label-a']])).toBe('all');
  });
});
