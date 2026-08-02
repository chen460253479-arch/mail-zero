import type { LabelSelectionState, Mailbox, MailboxRole } from '@/modules/mail/model/mailbox';
import { buildMailboxTree } from '@/modules/mail/selectors/mailbox-tree';

export type MoveTarget = {
  mailbox: Mailbox;
  depth: number;
  displayName: string;
};

type MailboxDisplayNameResolver = (mailbox: Mailbox) => string;

const moveSystemRoles = new Set<MailboxRole>(['inbox', 'archive', 'junk', 'trash']);

const compareMailboxes = (left: Mailbox, right: Mailbox) =>
  left.sortOrder - right.sortOrder ||
  left.name.localeCompare(right.name) ||
  left.id.localeCompare(right.id);

export function buildMoveTargets(
  mailboxes: readonly Mailbox[],
  currentMailboxId: string | null,
  search: string,
  getDisplayName: MailboxDisplayNameResolver = (mailbox) => mailbox.name,
): MoveTarget[] {
  const systems = mailboxes
    .filter(
      (mailbox) =>
        mailbox.kind === 'system' &&
        mailbox.role !== null &&
        moveSystemRoles.has(mailbox.role) &&
        mailbox.id !== currentMailboxId,
    )
    .toSorted(compareMailboxes)
    .map((mailbox) => ({ mailbox, depth: 0 }));
  const folders: Array<Omit<MoveTarget, 'displayName'>> = [];
  const visit = (nodes: ReturnType<typeof buildMailboxTree>, depth: number) => {
    for (const node of nodes) {
      if (node.id !== currentMailboxId) folders.push({ mailbox: node, depth });
      visit(node.children, depth + 1);
    }
  };
  visit(buildMailboxTree(mailboxes, { kind: 'folder' }), 0);

  const targets = [...systems, ...folders].map((target) => ({
    ...target,
    displayName: getDisplayName(target.mailbox),
  }));
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return targets.filter(
    ({ displayName }) =>
      normalizedSearch.length === 0 || displayName.toLocaleLowerCase().includes(normalizedSearch),
  );
}

export function buildLabelMutation(
  changes: Readonly<Record<string, boolean>>,
  mailboxes: readonly Mailbox[],
) {
  const labelIds = new Set(
    mailboxes.filter((mailbox) => mailbox.kind === 'label').map((mailbox) => mailbox.id),
  );
  const entries = Object.entries(changes).filter(([mailboxId]) => labelIds.has(mailboxId));
  return {
    addLabelIds: entries.filter(([, selected]) => selected).map(([mailboxId]) => mailboxId),
    removeLabelIds: entries.filter(([, selected]) => !selected).map(([mailboxId]) => mailboxId),
  };
}

export const nextLabelSelectionState = (state: LabelSelectionState) => state !== 'all';
