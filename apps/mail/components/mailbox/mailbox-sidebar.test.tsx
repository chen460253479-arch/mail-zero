import { describe, expect, it } from 'vitest';

import type { Mailbox } from '@/modules/mail/model/mailbox';
import { createMailboxSidebarModel } from './mailbox-sidebar';
import { mailboxNodeHref } from './mailbox-tree-node';

const mailbox = (
  id: string,
  kind: Mailbox['kind'],
  options: Partial<Mailbox> = {},
): Mailbox => ({
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
  ...options,
});

describe('MailboxSidebar', () => {
  it('shows subscribed folder and label trees together without provider capabilities', () => {
    const model = createMailboxSidebarModel([
      mailbox('folder-parent', 'folder'),
      mailbox('folder-child', 'folder', { parentId: 'folder-parent', unreadThreads: 2 }),
      mailbox('label-parent', 'label'),
      mailbox('label-child', 'label', { parentId: 'label-parent', unreadThreads: 4 }),
      mailbox('hidden-folder', 'folder', { isSubscribed: false }),
      mailbox('hidden-label', 'label', { isSubscribed: false }),
    ]);

    expect(model.folders.map((node) => node.id)).toEqual(['folder-parent']);
    expect(model.folders[0]?.children[0]).toMatchObject({
      id: 'folder-child',
      unreadThreads: 2,
    });
    expect(model.labels.map((node) => node.id)).toEqual(['label-parent']);
    expect(model.labels[0]?.children[0]).toMatchObject({ id: 'label-child', unreadThreads: 4 });
  });

  it('routes every custom node by its opaque mailbox id', () => {
    expect(mailboxNodeHref('mailbox/with-provider-looking-name')).toBe(
      '/mail/mailbox%2Fwith-provider-looking-name',
    );
  });
});
