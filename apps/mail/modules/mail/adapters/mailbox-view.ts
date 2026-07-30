import type { Mailbox } from '../model/mailbox';
import type { Label } from '../../../types';

const SYSTEM_LABELS: Label[] = [
  { id: '$important', name: 'IMPORTANT', type: 'system' },
  { id: '$flagged', name: 'STARRED', type: 'system' },
];

const toLabel = (mailbox: Mailbox, labels?: Label[]): Label => ({
  id: mailbox.id,
  name: mailbox.name,
  type: mailbox.kind,
  ...(mailbox.color
    ? {
        color: {
          backgroundColor: mailbox.color,
          textColor: mailbox.color,
        },
      }
    : {}),
  ...(labels && labels.length > 0 ? { labels } : {}),
});

export function buildMailboxStats(mailboxes: readonly Mailbox[]) {
  return mailboxes.map((mailbox) => ({
    label: mailbox.role ?? mailbox.name,
    count: mailbox.totalThreads,
  }));
}

export function buildLabelView(mailboxes: readonly Mailbox[]) {
  const userMailboxes = mailboxes
    .filter((mailbox) => mailbox.kind === 'folder' || mailbox.kind === 'label')
    .toSorted(
      (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
    );
  const byParent = new Map<string | null, Mailbox[]>();

  for (const mailbox of userMailboxes) {
    const parentId =
      mailbox.parentId && userMailboxes.some((candidate) => candidate.id === mailbox.parentId)
        ? mailbox.parentId
        : null;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), mailbox]);
  }

  const build = (mailbox: Mailbox, ancestors: ReadonlySet<string>): Label => {
    if (ancestors.has(mailbox.id)) return toLabel(mailbox);
    const nextAncestors = new Set(ancestors).add(mailbox.id);
    const children = (byParent.get(mailbox.id) ?? []).map((child) => build(child, nextAncestors));
    return toLabel(mailbox, children);
  };

  return {
    userLabels: (byParent.get(null) ?? []).map((mailbox) => build(mailbox, new Set())),
    systemLabels: SYSTEM_LABELS.map((label) => ({ ...label })),
  };
}
