import type { LabelSelectionState, Mailbox, MailboxRole } from '../model/mailbox';

const primarySystemRoles = new Set<MailboxRole>(['inbox', 'archive', 'junk', 'trash']);

export function resolvePrimaryMailboxIds(
  mailboxes: readonly Mailbox[],
  mailboxIds: readonly string[],
): string[] {
  const byId = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  return [...new Set(mailboxIds)].filter((mailboxId) => {
    const mailbox = byId.get(mailboxId);
    return (
      mailbox?.kind === 'folder' ||
      (mailbox?.kind === 'system' &&
        mailbox.role !== null &&
        primarySystemRoles.has(mailbox.role))
    );
  });
}

export function labelSelectionState(
  labelId: string,
  threadMailboxIds: readonly (readonly string[])[],
): LabelSelectionState {
  if (threadMailboxIds.length === 0) return 'none';
  const selectedCount = threadMailboxIds.reduce(
    (count, mailboxIds) => count + Number(new Set(mailboxIds).has(labelId)),
    0,
  );
  if (selectedCount === 0) return 'none';
  return selectedCount === threadMailboxIds.length ? 'all' : 'partial';
}
