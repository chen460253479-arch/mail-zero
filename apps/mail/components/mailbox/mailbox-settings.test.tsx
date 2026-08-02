import { describe, expect, it } from 'vitest';

import type { Mailbox } from '@/modules/mail/model/mailbox';
import {
  getMailboxDeleteConstraint,
  getMailboxParentOptions,
  reorderMailboxSiblings,
  validateMailboxEditorInput,
} from './mailbox-settings';

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

const mailboxes = [
  mailbox('folder-root', 'folder', { name: 'Projects' }),
  mailbox('folder-child', 'folder', { parentId: 'folder-root', name: 'Client' }),
  mailbox('folder-grandchild', 'folder', { parentId: 'folder-child', name: 'Invoices' }),
  mailbox('folder-sibling', 'folder', { name: 'Archive 2026', sortOrder: 10 }),
  mailbox('label-root', 'label', { name: 'Customer' }),
];

describe('Mailbox settings domain', () => {
  it('offers only same-kind parents and excludes the edited node and descendants', () => {
    expect(getMailboxParentOptions(mailboxes, 'folder', 'folder-root').map(({ id }) => id)).toEqual([
      'folder-sibling',
    ]);
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
    ).toEqual({ ok: false, message: '名称不能为空。' });
    expect(
      validateMailboxEditorInput({
        mailboxes,
        kind: 'folder',
        editingId: null,
        name: ' projects ',
        parentId: null,
      }),
    ).toEqual({ ok: false, message: '同一层级已存在同名项目。' });
    expect(
      validateMailboxEditorInput({
        mailboxes,
        kind: 'folder',
        editingId: 'folder-root',
        name: 'Projects',
        parentId: 'folder-grandchild',
      }),
    ).toEqual({ ok: false, message: '不能将自身或子项设为父级。' });
    expect(
      validateMailboxEditorInput({
        mailboxes,
        kind: 'folder',
        editingId: null,
        name: 'Valid',
        parentId: 'label-root',
      }),
    ).toEqual({ ok: false, message: '父级必须与当前项目类型一致。' });
    expect(
      validateMailboxEditorInput({
        mailboxes,
        kind: 'folder',
        editingId: null,
        name: 'Level 4',
        parentId: 'folder-grandchild',
        maxDepth: 3,
      }),
    ).toEqual({ ok: false, message: '层级不能超过 3 级。' });
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
    expect(getMailboxDeleteConstraint(mailbox('inbox', 'system', { role: 'inbox' }), mailboxes)).toBe(
      '系统邮箱不能修改或删除。',
    );
    expect(getMailboxDeleteConstraint(mailboxes[0]!, mailboxes)).toBe(
      '该项目仍有子项，请先移动或删除子项。',
    );
    expect(
      getMailboxDeleteConstraint(mailbox('used-folder', 'folder', { totalThreads: 2 }), mailboxes),
    ).toBe('该文件夹仍有邮件，请先移动或清空邮件。');
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
