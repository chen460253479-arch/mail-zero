import type { MailboxRecord, MailCoreDependencies, MailTransaction } from '../store';
import type { CreateMailboxInput } from './types';
import type { MailboxId } from '../types';
import { MailCoreError } from '../types';

export const normalizeMailboxName = (name: string): string =>
  name.trim().normalize('NFC').toLocaleLowerCase('und');

export async function requireMailboxParent(
  tx: MailTransaction,
  accountId: CreateMailboxInput['accountId'],
  parentId: MailboxId | null,
): Promise<void> {
  if (parentId === null) {
    return;
  }
  if ((await tx.mailboxes.findById(accountId, parentId)) !== null) {
    return;
  }
  if (await tx.mailboxes.existsOutsideAccount(accountId, parentId)) {
    throw new MailCoreError('CROSS_ACCOUNT_REFERENCE', {
      entityId: parentId,
    });
  }
  throw new MailCoreError('MAILBOX_NOT_FOUND', { entityId: parentId });
}

export async function createMailbox(
  dependencies: MailCoreDependencies,
  input: CreateMailboxInput,
): Promise<MailboxRecord> {
  const id = dependencies.idFactory.next<'Mailbox'>() as MailboxId;
  const name = input.name.trim().normalize('NFC');
  const normalizedName = normalizeMailboxName(input.name);
  const now = dependencies.clock.now();

  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    if ((await tx.accounts.findById(input.accountId)) === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', {
        entityId: input.accountId,
      });
    }
    if (input.kind === 'system' || input.role !== null) {
      throw new MailCoreError('MAILBOX_ROLE_CONFLICT');
    }
    await requireMailboxParent(tx, input.accountId, input.parentId);
    if (
      (await tx.mailboxes.findByNormalizedName(input.accountId, input.parentId, normalizedName)) !==
      null
    ) {
      throw new MailCoreError('MAILBOX_NAME_CONFLICT');
    }

    const mailbox = await tx.mailboxes.insert({
      id,
      accountId: input.accountId,
      parentId: input.parentId,
      name,
      normalizedName,
      kind: input.kind,
      role: null,
      color: null,
      sortOrder: 0,
      isSubscribed: true,
      totalEmails: 0,
      unreadEmails: 0,
      totalThreads: 0,
      unreadThreads: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    const stateVersion = await tx.nextStateVersion(input.accountId);
    await tx.changes.recordChange({
      accountId: input.accountId,
      stateVersion,
      collection: 'mailbox',
      entityId: mailbox.id,
      changeType: 'created',
      changedProperties: null,
      createdAt: now,
    });
    return mailbox;
  });
}
