import { updateMailboxCounters, updateThreadCounters, type EmailStateInput } from './update-email';
import { MailCoreError, type EmailId } from '../types';
import type { MailCoreDependencies } from '../store';
import { recordChanges } from '../changes';

export type DestroyEmailInput = EmailStateInput;

export type DestroyEmailResult = {
  emailId: EmailId;
  stateVersion: bigint;
};

export async function destroyEmail(
  dependencies: MailCoreDependencies,
  input: DestroyEmailInput,
): Promise<DestroyEmailResult> {
  const now = dependencies.clock.now();
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const email = await tx.emails.findById(input.accountId, input.emailId);
    if (email === null) {
      throw new MailCoreError('EMAIL_NOT_FOUND', { entityId: input.emailId });
    }
    if (email.destroyedAt !== null) {
      const account = await tx.accounts.findById(input.accountId);
      if (account === null) {
        throw new MailCoreError('ACCOUNT_NOT_FOUND', {
          entityId: input.accountId,
        });
      }
      return {
        emailId: email.id,
        stateVersion: account.stateVersion,
      };
    }

    await tx.emails.update(input.accountId, input.emailId, {
      destroyedAt: now,
      updatedAt: now,
      mailboxIds: [],
      restoreMailboxIds: [],
      keywords: [],
      blobId: null,
      textBlobId: null,
      htmlBlobId: null,
      parts: [],
    });
    const mailboxChanges = await updateMailboxCounters(tx, input.accountId, now);
    const threadChange = await updateThreadCounters(tx, input.accountId, email.threadId, now);
    const stateVersion = await recordChanges(tx, {
      accountId: input.accountId,
      changes: [
        {
          collection: 'email',
          entityId: email.id,
          changeType: 'destroyed',
          changedProperties: null,
        },
        ...(threadChange === null ? [] : [threadChange]),
        ...mailboxChanges,
      ],
      createdAt: now,
    });
    return { emailId: email.id, stateVersion };
  });
}
