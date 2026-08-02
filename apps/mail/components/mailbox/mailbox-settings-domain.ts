import { arrayMove } from '@dnd-kit/sortable';

import type { CustomMailboxKind, Mailbox } from '@/modules/mail/model/mailbox';

const compareMailboxes = (left: Mailbox, right: Mailbox) =>
  left.sortOrder - right.sortOrder ||
  left.name.localeCompare(right.name) ||
  left.id.localeCompare(right.id);

const descendantIds = (mailboxes: readonly Mailbox[], rootId: string): Set<string> => {
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const mailbox of mailboxes) {
      if (
        mailbox.parentId !== null &&
        (mailbox.parentId === rootId || descendants.has(mailbox.parentId)) &&
        !descendants.has(mailbox.id)
      ) {
        descendants.add(mailbox.id);
        changed = true;
      }
    }
  }
  return descendants;
};

export function getMailboxParentOptions(
  mailboxes: readonly Mailbox[],
  kind: CustomMailboxKind,
  editingId: string | null,
): Mailbox[] {
  const excluded = editingId === null ? new Set<string>() : descendantIds(mailboxes, editingId);
  if (editingId !== null) excluded.add(editingId);
  return mailboxes
    .filter((mailbox) => mailbox.kind === kind && !excluded.has(mailbox.id))
    .toSorted(compareMailboxes);
}

const mailboxDepth = (mailboxes: readonly Mailbox[], mailboxId: string): number => {
  const byId = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  const visited = new Set<string>();
  let depth = 0;
  let currentId: string | null = mailboxId;
  while (currentId !== null) {
    if (visited.has(currentId)) return Number.MAX_SAFE_INTEGER;
    visited.add(currentId);
    const mailbox = byId.get(currentId);
    if (!mailbox) return Number.MAX_SAFE_INTEGER;
    depth += 1;
    currentId = mailbox.parentId;
  }
  return depth;
};

const subtreeHeight = (mailboxes: readonly Mailbox[], mailboxId: string): number => {
  const children = mailboxes.filter((mailbox) => mailbox.parentId === mailboxId);
  return children.length === 0
    ? 1
    : 1 + Math.max(...children.map((child) => subtreeHeight(mailboxes, child.id)));
};

export type MailboxEditorValidation =
  | { ok: true; name: string; parentId: string | null }
  | { ok: false; message: string };

export function validateMailboxEditorInput({
  mailboxes,
  kind,
  editingId,
  name,
  parentId,
  maxDepth = 10,
}: {
  mailboxes: readonly Mailbox[];
  kind: CustomMailboxKind;
  editingId: string | null;
  name: string;
  parentId: string | null;
  maxDepth?: number;
}): MailboxEditorValidation {
  const normalizedName = name.trim();
  if (!normalizedName) return { ok: false, message: '名称不能为空。' };

  const parent = parentId === null ? null : mailboxes.find((mailbox) => mailbox.id === parentId);
  if (parentId !== null && (!parent || parent.kind !== kind)) {
    return { ok: false, message: '父级必须与当前项目类型一致。' };
  }
  if (
    editingId !== null &&
    (parentId === editingId || descendantIds(mailboxes, editingId).has(parentId ?? ''))
  ) {
    return { ok: false, message: '不能将自身或子项设为父级。' };
  }

  const conflict = mailboxes.some(
    (mailbox) =>
      mailbox.id !== editingId &&
      mailbox.kind === kind &&
      mailbox.parentId === parentId &&
      mailbox.name.trim().localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0,
  );
  if (conflict) return { ok: false, message: '同一层级已存在同名项目。' };

  const parentDepth = parent ? mailboxDepth(mailboxes, parent.id) : 0;
  const height = editingId === null ? 1 : subtreeHeight(mailboxes, editingId);
  if (parentDepth + height > maxDepth) {
    return { ok: false, message: `层级不能超过 ${maxDepth} 级。` };
  }
  return { ok: true, name: normalizedName, parentId };
}

export function getMailboxDeleteConstraint(
  mailbox: Mailbox,
  mailboxes: readonly Mailbox[],
): string | null {
  if (mailbox.kind === 'system') return '系统邮箱不能修改或删除。';
  if (mailboxes.some((candidate) => candidate.parentId === mailbox.id)) {
    return '该项目仍有子项，请先移动或删除子项。';
  }
  if (mailbox.kind === 'folder' && (mailbox.totalThreads > 0 || mailbox.totalEmails > 0)) {
    return '该文件夹仍有邮件，请先移动或清空邮件。';
  }
  return null;
}

export function reorderMailboxSiblings(
  mailboxes: readonly Mailbox[],
  activeId: string,
  overId: string,
): Array<{ id: string; sortOrder: number }> {
  const active = mailboxes.find((mailbox) => mailbox.id === activeId);
  const over = mailboxes.find((mailbox) => mailbox.id === overId);
  if (
    !active ||
    !over ||
    active.kind === 'system' ||
    active.kind !== over.kind ||
    active.parentId !== over.parentId
  ) {
    return [];
  }
  const siblings = mailboxes
    .filter(
      (mailbox) => mailbox.kind === active.kind && mailbox.parentId === active.parentId,
    )
    .toSorted(compareMailboxes);
  const oldIndex = siblings.findIndex((mailbox) => mailbox.id === activeId);
  const newIndex = siblings.findIndex((mailbox) => mailbox.id === overId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return [];
  return arrayMove(siblings, oldIndex, newIndex).map((mailbox, index) => ({
    id: mailbox.id,
    sortOrder: index * 10,
  }));
}
