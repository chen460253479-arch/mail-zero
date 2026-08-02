import type { Mailbox, MailboxRole } from '@/modules/mail/model/mailbox';

export type SystemMailboxDisplayNames = Partial<Record<MailboxRole, string>>;

export function getMailboxDisplayName(mailbox: Mailbox, systemNames: SystemMailboxDisplayNames) {
  if (mailbox.kind === 'system' && mailbox.role !== null) {
    return systemNames[mailbox.role] ?? mailbox.name;
  }

  return mailbox.name;
}
