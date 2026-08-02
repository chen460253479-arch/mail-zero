import { describe, expect, it } from 'vitest';

import {
  getMailboxDeleteConstraint,
  getMailboxParentOptions,
  reorderMailboxSiblings,
  validateMailboxEditorInput,
} from './mailbox-settings';
import type { Mailbox } from '@/modules/mail/model/mailbox';

const mailbox = (id: string, kind: Mailbox['kind'], options: Partial<Mailbox> = {}): Mailbox => ({
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

const mailboxes = [
  mailbox('folder-root', 'folder', { name: 'Projects' }),
  mailbox('folder-child', 'folder', { parentId: 'folder-root', name: 'Client' }),
  mailbox('folder-grandchild', 'folder', { parentId: 'folder-child', name: 'Invoices' }),
  mailbox('folder-sibling', 'folder', { name: 'Archive 2026', sortOrder: 10 }),
  mailbox('label-root', 'label', { name: 'Customer' }),
];

describe('Mailbox settings domain', () => {
  it('offers only same-kind parents and excludes the edited node and descendants', () => {
    expect(getMailboxParentOptions(mailboxes, 'folder', 'folder-root').map(({ id }) => id)).toEqual(
      ['folder-sibling'],
    );
    expect(getMailboxParentOptions(mailboxes, 'label', null).map(({ id }) => id)).toEqual([
      'label-root',
    ]);
  });

  it('validates trimmed names, sibling uniqueness, parent type, cycles, and depth', () => {
    expect(
      validateMailboxEditorInput({
        mailboxes,
        kind: 'folder',
        editingId: null,
        name: '   ',
        parentId: null,
      }),
    ).toEqual({ ok: false, code: 'NAME_REQUIRED' });
    expect(
      validateMailboxEditorInput({
        mailboxes,
        kind: 'folder',
        editingId: null,
        name: ' projects ',
        parentId: null,
      }),
    ).toEqual({ ok: false, code: 'SIBLING_NAME_CONFLICT' });
    expect(
      validateMailboxEditorInput({
        mailboxes,
        kind: 'folder',
        editingId: 'folder-root',
        name: 'Projects',
        parentId: 'folder-grandchild',
      }),
    ).toEqual({ ok: false, code: 'PARENT_CYCLE' });
    expect(
      validateMailboxEditorInput({
        mailboxes,
        kind: 'folder',
        editingId: null,
        name: 'Valid',
        parentId: 'label-root',
      }),
    ).toEqual({ ok: false, code: 'PARENT_KIND_MISMATCH' });
    expect(
      validateMailboxEditorInput({
        mailboxes,
        kind: 'folder',
        editingId: null,
        name: 'Level 4',
        parentId: 'folder-grandchild',
        maxDepth: 3,
      }),
    ).toEqual({ ok: false, code: 'MAX_DEPTH_EXCEEDED', maxDepth: 3 });
    expect(
      validateMailboxEditorInput({
        mailboxes,
        kind: 'label',
        editingId: null,
        name: '  VIP  ',
        parentId: 'label-root',
      }),
    ).toEqual({ ok: true, name: 'VIP', parentId: 'label-root' });
  });

  it('protects system rows and enforces folder and label delete constraints', () => {
    expect(
      getMailboxDeleteConstraint(mailbox('inbox', 'system', { role: 'inbox' }), mailboxes),
    ).toBe('SYSTEM_MAILBOX');
    expect(getMailboxDeleteConstraint(mailboxes[0]!, mailboxes)).toBe('HAS_CHILDREN');
    expect(
      getMailboxDeleteConstraint(mailbox('used-folder', 'folder', { totalThreads: 2 }), mailboxes),
    ).toBe('FOLDER_HAS_MAIL');
    expect(
      getMailboxDeleteConstraint(mailbox('used-label', 'label', { totalThreads: 2 }), mailboxes),
    ).toBeNull();
  });

  it('reorders only siblings of the same kind with deterministic sort values', () => {
    expect(reorderMailboxSiblings(mailboxes, 'folder-sibling', 'folder-root')).toEqual([
      { id: 'folder-sibling', sortOrder: 0 },
      { id: 'folder-root', sortOrder: 10 },
    ]);
    expect(reorderMailboxSiblings(mailboxes, 'folder-child', 'folder-sibling')).toEqual([]);
    expect(reorderMailboxSiblings(mailboxes, 'folder-root', 'label-root')).toEqual([]);
  });
});
