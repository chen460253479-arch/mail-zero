import type { Mailbox } from '../model/mailbox';

const unreadSystemRoles = new Set(['inbox', 'junk']);

export function mailboxBadgeCount(mailbox: Mailbox): number | null {
  let count: number | null = null;
  if (mailbox.kind === 'folder' || mailbox.kind === 'label') {
    count = mailbox.unreadThreads;
  } else if (mailbox.role !== null && unreadSystemRoles.has(mailbox.role)) {
    count = mailbox.unreadThreads;
  } else if (mailbox.role === 'drafts' || mailbox.role === 'sent') {
    count = mailbox.totalThreads;
  }
  return count !== null && count > 0 ? count : null;
}
