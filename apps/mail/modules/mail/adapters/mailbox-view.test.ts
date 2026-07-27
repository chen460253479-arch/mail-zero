import { describe, expect, it } from 'vitest';

import type { Mailbox } from '../model/mailbox';
import { buildLabelView } from './mailbox-view';

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
