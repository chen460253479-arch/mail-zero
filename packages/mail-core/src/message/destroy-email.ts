import type { MailCoreDependencies, MailTransaction } from '../store';
import { applyEmailAggregateDelta } from './email-aggregates';
import { MailCoreError, type EmailId } from '../types';
import type { EmailStateInput } from './update-email';
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
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    return destroyEmailInTransaction(dependencies, tx, input);
  });
}

export async function destroyEmailInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: DestroyEmailInput,
): Promise<DestroyEmailResult> {
  const now = dependencies.clock.now();
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

  const destroyed = await tx.emails.update(input.accountId, input.emailId, {
    destroyedAt: now,
    updatedAt: now,
    identityId: null,
    mailboxIds: [],
    restoreMailboxIds: [],
    keywords: [],
    blobId: null,
    replyToEmailId: null,
    messageId: null,
    inReplyTo: [],
    references: [],
    subject: '',
    preview: '',
    sizeBytes: 0n,
    hasAttachment: false,
    sender: [],
    from: [],
    replyTo: [],
    to: [],
    cc: [],
    bcc: [],
    textBlobId: null,
    htmlBlobId: null,
    parseWarnings: [],
    parts: [],
  });
  await tx.emails.deleteSearchDocument(input.accountId, input.emailId);
  await tx.threadReferences.deleteByEmail(input.accountId, input.emailId);
  const aggregateChanges = await applyEmailAggregateDelta(tx, {
    accountId: input.accountId,
    before: email,
    after: destroyed,
    now,
  });
  const stateVersion = await recordChanges(tx, {
    accountId: input.accountId,
    changes: [
      {
        collection: 'email',
        entityId: email.id,
        changeType: 'destroyed',
        changedProperties: null,
      },
      ...aggregateChanges,
    ],
    createdAt: now,
  });
  return { emailId: email.id, stateVersion };
}
