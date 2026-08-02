import { mailboxBadgeCount } from '../selectors/mailbox-count';
import type { Mailbox } from '../model/mailbox';

export function buildMailboxStats(mailboxes: readonly Mailbox[]) {
  return mailboxes.flatMap((mailbox) => {
    const count = mailboxBadgeCount(mailbox);
    return count === null
      ? []
      : [{ label: mailbox.role ?? mailbox.id, mailboxId: mailbox.id, count }];
  });
}
