import type { CustomMailboxKind, Mailbox, MailboxTreeNode } from '../model/mailbox';

export type BuildMailboxTreeOptions = {
  kind: CustomMailboxKind;
  subscribedOnly?: boolean;
};

const compareMailboxes = (left: Mailbox, right: Mailbox): number =>
  left.sortOrder - right.sortOrder ||
  left.name.localeCompare(right.name) ||
  left.id.localeCompare(right.id);

const resolvedParentId = (
  mailbox: Mailbox,
  byId: ReadonlyMap<string, Mailbox>,
): string | null => {
  if (mailbox.parentId === null) return null;

  const visited = new Set([mailbox.id]);
  let parentId: string | null = mailbox.parentId;
  while (parentId !== null) {
    const parent = byId.get(parentId);
    if (!parent || parent.kind !== mailbox.kind || visited.has(parent.id)) return null;
    visited.add(parent.id);
    parentId = parent.parentId;
  }
  return mailbox.parentId;
};

export function buildMailboxTree(
  mailboxes: readonly Mailbox[],
  { kind, subscribedOnly = false }: BuildMailboxTreeOptions,
): MailboxTreeNode[] {
  const visible = mailboxes.filter(
    (mailbox) => mailbox.kind === kind && (!subscribedOnly || mailbox.isSubscribed),
  );
  const byId = new Map(visible.map((mailbox) => [mailbox.id, mailbox]));
  const childrenByParent = new Map<string | null, Mailbox[]>();

  for (const mailbox of byId.values()) {
    const parentId = resolvedParentId(mailbox, byId);
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), mailbox]);
  }
  for (const children of childrenByParent.values()) children.sort(compareMailboxes);

  const buildNode = (mailbox: Mailbox): MailboxTreeNode => ({
    ...mailbox,
    children: (childrenByParent.get(mailbox.id) ?? []).map(buildNode),
  });

  return (childrenByParent.get(null) ?? []).map(buildNode);
}
