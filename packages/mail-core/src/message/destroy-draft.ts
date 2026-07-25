import { updateMailboxCounters, updateThreadCounters } from './update-email';
import type { DestroyDraftInput, DestroyDraftResult } from './draft-types';
import type { MailCoreDependencies } from '../store';
import { recordChanges } from '../changes';
import { MailCoreError } from '../types';

export async function destroyDraft(
  dependencies: MailCoreDependencies,
  input: DestroyDraftInput,
): Promise<DestroyDraftResult> {
  const now = dependencies.clock.now();
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const email = await tx.emails.findById(input.accountId, input.emailId);
    if (email === null) {
      throw new MailCoreError('EMAIL_NOT_FOUND', { entityId: input.emailId });
    }
    if (email.lifecycle !== 'draft') {
      throw new MailCoreError('EMAIL_CONTENT_IMMUTABLE', { entityId: input.emailId });
    }
    if (email.destroyedAt !== null) {
      const account = await tx.accounts.findById(input.accountId);
      if (account === null) {
        throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
      }
      return { emailId: email.id, stateVersion: account.stateVersion };
    }

    await tx.emails.update(input.accountId, input.emailId, {
      destroyedAt: now,
      updatedAt: now,
      mailboxIds: [],
      restoreMailboxIds: [],
      keywords: [],
      blobId: null,
      replyToEmailId: null,
      textBlobId: null,
      htmlBlobId: null,
      parts: [],
    });
    const threadChange = await updateThreadCounters(tx, input.accountId, email.threadId, now);
    const mailboxChanges = await updateMailboxCounters(tx, input.accountId, now);
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
