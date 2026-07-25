import type { MailCoreDependencies } from '../store';
import type { DestroyMailboxInput } from './types';
import { MailCoreError } from '../types';

export async function destroyMailbox(
  dependencies: MailCoreDependencies,
  input: DestroyMailboxInput,
): Promise<void> {
  const now = dependencies.clock.now();

  return dependencies.unitOfWork.run(async (tx) => {
    const mailbox = await tx.mailboxes.findById(input.accountId, input.mailboxId);
    if (mailbox === null) {
      throw new MailCoreError('MAILBOX_NOT_FOUND', {
        entityId: input.mailboxId,
      });
    }
    if (mailbox.kind === 'system') {
      throw new MailCoreError('MAILBOX_ROLE_CONFLICT', {
        entityId: input.mailboxId,
      });
    }
    if (
      (await tx.mailboxes.listByAccount(input.accountId)).some(
        (candidate) => candidate.parentId === mailbox.id,
      )
    ) {
      throw new MailCoreError('MAILBOX_HAS_CHILD', {
        entityId: input.mailboxId,
      });
    }
    if (
      (await tx.emails.listByAccount(input.accountId)).some((email) =>
        email.mailboxIds.includes(mailbox.id),
      )
    ) {
      throw new MailCoreError('MAILBOX_HAS_EMAIL', {
        entityId: input.mailboxId,
      });
    }

    await tx.mailboxes.delete(input.accountId, input.mailboxId);
    const stateVersion = await tx.nextStateVersion(input.accountId);
    await tx.changes.recordChange({
      accountId: input.accountId,
      stateVersion,
      collection: 'mailbox',
      entityId: mailbox.id,
      changeType: 'destroyed',
      changedProperties: null,
      createdAt: now,
    });
  });
}
