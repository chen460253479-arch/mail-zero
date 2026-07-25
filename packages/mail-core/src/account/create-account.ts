import type { MailAccountRecord, MailboxRecord, MailCoreDependencies } from '../store';
import type { MailAccountId, MailboxId, MailboxRole } from '../types';
import type { CreateMailAccountInput } from './types';

const systemMailboxes: ReadonlyArray<{
  role: MailboxRole;
  name: string;
}> = [
  { role: 'inbox', name: 'Inbox' },
  { role: 'sent', name: 'Sent' },
  { role: 'drafts', name: 'Drafts' },
  { role: 'trash', name: 'Trash' },
  { role: 'junk', name: 'Junk' },
  { role: 'archive', name: 'Archive' },
  { role: 'outbox', name: 'Outbox' },
  { role: 'scheduled', name: 'Scheduled' },
];

const normalizeMailboxName = (name: string): string =>
  name.trim().normalize('NFC').toLocaleLowerCase('und');

export async function createMailAccount(
  dependencies: MailCoreDependencies,
  input: CreateMailAccountInput,
): Promise<MailAccountRecord> {
  const accountId = dependencies.idFactory.next<'MailAccount'>() as MailAccountId;
  const mailboxIds = systemMailboxes.map(
    () => dependencies.idFactory.next<'Mailbox'>() as MailboxId,
  );
  const now = dependencies.clock.now();

  return dependencies.unitOfWork.run(async (tx) => {
    const account = await tx.accounts.insert({
      id: accountId,
      userId: input.userId,
      connectionId: input.connectionId,
      status: 'active',
      stateVersion: 0n,
      timezone: input.timezone,
      storageQuotaBytes: input.storageQuotaBytes,
      createdAt: now,
      updatedAt: now,
    });
    const stateVersion = await tx.nextStateVersion(accountId);

    for (const [index, systemMailbox] of systemMailboxes.entries()) {
      const mailbox: MailboxRecord = {
        id: mailboxIds[index]!,
        accountId,
        parentId: null,
        name: systemMailbox.name,
        normalizedName: normalizeMailboxName(systemMailbox.name),
        kind: 'system',
        role: systemMailbox.role,
        color: null,
        sortOrder: index,
        isSubscribed: true,
        totalEmails: 0,
        unreadEmails: 0,
        totalThreads: 0,
        unreadThreads: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await tx.mailboxes.insert(mailbox);
      await tx.changes.recordChange({
        accountId,
        stateVersion,
        collection: 'mailbox',
        entityId: mailbox.id,
        changeType: 'created',
        changedProperties: null,
        createdAt: now,
      });
    }

    return { ...account, stateVersion };
  });
}
