import type { MailCoreDependencies, MailTransaction } from '../store';
import type { DestroyMailboxInput } from './types';
import { MailCoreError } from '../types';
import {
  applyPreparedEmailStateInTransaction,
  prepareEmailStateReplacementInTransaction,
} from '../message/update-email';

export async function destroyMailbox(
  dependencies: MailCoreDependencies,
  input: DestroyMailboxInput,
): Promise<void> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    return destroyMailboxInTransaction(dependencies, tx, input);
  });
}

export async function destroyMailboxInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: DestroyMailboxInput,
): Promise<void> {
  const now = dependencies.clock.now();
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
  if (await tx.mailboxes.hasChild(input.accountId, mailbox.id)) {
    throw new MailCoreError('MAILBOX_HAS_CHILD', {
      entityId: input.mailboxId,
    });
  }
  if (mailbox.kind === 'folder' && (await tx.mailboxes.hasEmail(input.accountId, mailbox.id))) {
    throw new MailCoreError('MAILBOX_HAS_EMAIL', {
      entityId: input.mailboxId,
    });
  }

  if (mailbox.kind === 'label') {
    const prepared = [];
    for (const email of await tx.emails.listByMailbox(input.accountId, mailbox.id)) {
      prepared.push(
        await prepareEmailStateReplacementInTransaction(dependencies, tx, {
          accountId: input.accountId,
          emailId: email.id,
          mailboxIds: email.mailboxIds.filter((mailboxId) => mailboxId !== mailbox.id),
        }),
      );
    }
    for (const mutation of prepared) {
      await applyPreparedEmailStateInTransaction(tx, mutation);
    }
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
}
