import { describe, expect, it } from 'vitest';

import type { Mailbox, MailboxRole } from '../model/mailbox';
import { groupMailboxes } from './mailbox-groups';

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

const system = (role: MailboxRole) =>
  mailbox(`system-${role}`, role, 'system', { role });

describe('groupMailboxes', () => {
  it('groups system roles in navigation order and keeps folders and labels separate', () => {
    const groups = groupMailboxes([
      system('trash'),
      system('sent'),
      system('inbox'),
      system('junk'),
      system('archive'),
      system('drafts'),
      system('scheduled'),
      mailbox('folder-b', 'Beta', 'folder', { sortOrder: 1 }),
      mailbox('folder-a', 'Alpha', 'folder', { sortOrder: 1 }),
      mailbox('label-a', 'Customer', 'label'),
    ]);

    expect(groups.core.map((item) => item.role)).toEqual(['inbox', 'drafts', 'sent']);
    expect(groups.management.map((item) => item.role)).toEqual(['archive', 'junk', 'trash']);
    expect(groups.otherSystem.map((item) => item.role)).toEqual(['scheduled']);
    expect(groups.folders.map((item) => item.id)).toEqual(['folder-a', 'folder-b']);
    expect(groups.labels.map((item) => item.id)).toEqual(['label-a']);
  });

  it('uses isSubscribed only when building a visible navigation group', () => {
    const hiddenFolder = mailbox('hidden-folder', 'Hidden folder', 'folder', {
      isSubscribed: false,
    });
    const hiddenLabel = mailbox('hidden-label', 'Hidden label', 'label', {
      isSubscribed: false,
    });

    expect(
      groupMailboxes([hiddenFolder, hiddenLabel], { subscribedOnly: true }),
    ).toMatchObject({ folders: [], labels: [] });
    expect(groupMailboxes([hiddenFolder, hiddenLabel])).toMatchObject({
      folders: [hiddenFolder],
      labels: [hiddenLabel],
    });
  });
});
