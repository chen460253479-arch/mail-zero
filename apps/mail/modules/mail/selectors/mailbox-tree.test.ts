import { describe, expect, it } from 'vitest';

import type { Mailbox } from '../model/mailbox';
import { buildMailboxTree } from './mailbox-tree';

const mailbox = (
  id: string,
  name: string,
  kind: Mailbox['kind'],
  options: Partial<Mailbox> = {},
): Mailbox => ({
  id,
  parentId: null,
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
  ...options,
});

describe('buildMailboxTree', () => {
  it('uses parentId and stable sortOrder, name, and id ordering without mutating input', () => {
    const input = [
      mailbox('root-b', 'Beta', 'folder', { sortOrder: 1 }),
      mailbox('child-b', 'Same', 'folder', { parentId: 'root-a', sortOrder: 2 }),
      mailbox('root-a', 'Alpha', 'folder', { sortOrder: 1 }),
      mailbox('child-a-2', 'Same', 'folder', { parentId: 'root-a', sortOrder: 1 }),
      mailbox('child-a-1', 'Same', 'folder', { parentId: 'root-a', sortOrder: 1 }),
    ];

    const tree = buildMailboxTree(input, { kind: 'folder' });

    expect(tree.map((node) => node.id)).toEqual(['root-a', 'root-b']);
    expect(tree[0]?.children.map((node) => node.id)).toEqual([
      'child-a-1',
      'child-a-2',
      'child-b',
    ]);
    expect(input).not.toHaveProperty('0.children');
  });

  it('recovers orphan and cross-kind children to the root', () => {
    const tree = buildMailboxTree(
      [
        mailbox('label-parent', 'Label parent', 'label'),
        mailbox('cross-kind', 'Cross kind', 'folder', { parentId: 'label-parent' }),
        mailbox('orphan', 'Orphan', 'folder', { parentId: 'missing' }),
      ],
      { kind: 'folder' },
    );

    expect(tree.map((node) => node.id)).toEqual(['cross-kind', 'orphan']);
    expect(tree.every((node) => node.children.length === 0)).toBe(true);
  });

  it('breaks corrupt cycles and promotes subscribed children of hidden parents', () => {
    const tree = buildMailboxTree(
      [
        mailbox('cycle-a', 'Cycle A', 'folder', { parentId: 'cycle-b' }),
        mailbox('cycle-b', 'Cycle B', 'folder', { parentId: 'cycle-a' }),
        mailbox('hidden-parent', 'Hidden', 'folder', { isSubscribed: false }),
        mailbox('visible-child', 'Visible', 'folder', { parentId: 'hidden-parent' }),
        mailbox('hidden-child', 'Also hidden', 'folder', { isSubscribed: false }),
      ],
      { kind: 'folder', subscribedOnly: true },
    );

    expect(tree.map((node) => node.id)).toEqual(['cycle-a', 'cycle-b', 'visible-child']);
    expect(tree.flatMap((node) => node.children)).toEqual([]);
  });
});
