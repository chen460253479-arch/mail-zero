import { describe, expect, it } from 'vitest';

import type { Mailbox } from '@/modules/mail/model/mailbox';

import {
  buildLabelMutation,
  buildMoveTargets,
  nextLabelSelectionState,
} from './mail-action-menu-domain';

const mailbox = (id: string, kind: Mailbox['kind'], overrides: Partial<Mailbox> = {}): Mailbox => ({
  id,
  parentId: null,
  name: id,
  kind,
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

describe('mail action menu domain', () => {
  const mailboxes: Mailbox[] = [
    mailbox('inbox', 'system', { name: 'Inbox', role: 'inbox' }),
    mailbox('archive', 'system', { name: 'Archive', role: 'archive' }),
    mailbox('drafts', 'system', { name: 'Drafts', role: 'drafts' }),
    mailbox('sent', 'system', { name: 'Sent', role: 'sent' }),
    mailbox('projects', 'folder', { name: 'Projects', sortOrder: 1 }),
    mailbox('alpha', 'folder', { name: 'Alpha', parentId: 'projects', sortOrder: 2 }),
    mailbox('customer', 'label', { name: 'Customer' }),
  ];

  it('offers only organizational destinations and excludes the current mailbox', () => {
    expect(buildMoveTargets(mailboxes, 'inbox', '').map(({ mailbox }) => mailbox.id)).toEqual([
      'archive',
      'projects',
      'alpha',
    ]);
  });

  it('searches move destinations without losing their tree depth', () => {
    expect(buildMoveTargets(mailboxes, null, 'alp')).toEqual([
      expect.objectContaining({ mailbox: expect.objectContaining({ id: 'alpha' }), depth: 1 }),
    ]);
  });

  it('searches system destinations by their localized display name', () => {
    expect(
      buildMoveTargets(mailboxes, null, '收件箱', (mailbox) =>
        mailbox.role === 'inbox' ? '收件箱' : mailbox.name,
      ),
    ).toEqual([
      expect.objectContaining({
        mailbox: expect.objectContaining({ id: 'inbox' }),
        displayName: '收件箱',
      }),
    ]);
  });

  it('turns only explicitly changed labels into one add/remove mutation', () => {
    expect(
      buildLabelMutation(
        {
          customer: true,
          ignored: false,
          projects: true,
        },
        mailboxes,
      ),
    ).toEqual({ addLabelIds: ['customer'], removeLabelIds: [] });

    expect(buildLabelMutation({ customer: false }, mailboxes)).toEqual({
      addLabelIds: [],
      removeLabelIds: ['customer'],
    });
  });

  it('makes partial label selection checked on the next click', () => {
    expect(nextLabelSelectionState('partial')).toBe(true);
    expect(nextLabelSelectionState('none')).toBe(true);
    expect(nextLabelSelectionState('all')).toBe(false);
  });
});
