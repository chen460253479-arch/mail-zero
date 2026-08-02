import { describe, expect, it } from 'vitest';

import { buildLabelView, buildMailboxStats } from './mailbox-view';
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

describe('buildLabelView', () => {
  it('builds a local mailbox hierarchy for the existing label UI', () => {
    expect(
      buildLabelView([
        mailbox('label-parent', 'Customer', 'label'),
        mailbox('label-child', 'VIP', 'label', 'label-parent'),
        mailbox('folder-project', 'Projects', 'folder'),
      ]).userLabels,
    ).toEqual([
      {
        id: 'label-parent',
        name: 'Customer',
        type: 'label',
        labels: [{ id: 'label-child', name: 'VIP', type: 'label' }],
      },
      {
        id: 'folder-project',
        name: 'Projects',
        type: 'folder',
      },
    ]);
  });

  it('exposes local keyword views without Gmail category labels', () => {
    expect(buildLabelView([]).systemLabels).toEqual([
      { id: '$important', name: 'IMPORTANT', type: 'system' },
      { id: '$flagged', name: 'STARRED', type: 'system' },
    ]);
  });
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
    ).toEqual([{ label: 'inbox', mailboxId: 'mailbox-inbox', count: 2 }]);
  });
});
