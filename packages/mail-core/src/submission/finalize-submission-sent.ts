import type {
  EmailRecord,
  MailCoreDependencies,
  MailTransaction,
  SubmissionRecord,
} from '../store';
import { applyEmailAggregateDelta } from '../message/email-aggregates';
import { MailCoreError, type Keyword, type MailboxId } from '../types';
import type { FinalizeSubmissionSentInput } from './types';
import { recordChanges } from '../changes';

export type FinalizeSubmissionSentResult = {
  submission: SubmissionRecord;
  email: EmailRecord;
  stateVersion: bigint;
};

const sortStrings = <Value extends string>(values: Iterable<Value>): Value[] =>
  [...values].sort((left, right) => left.localeCompare(right));

const invalidFinalization = (entityId: string): never => {
  throw new MailCoreError('INVALID_SUBMISSION_TRANSITION', { entityId });
};

const currentStateVersion = async (
  tx: MailTransaction,
  accountId: FinalizeSubmissionSentInput['accountId'],
): Promise<bigint> => {
  const account = await tx.accounts.findById(accountId);
  if (account === null) {
    throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: accountId });
  }
  return account.stateVersion;
};

const requireProviderResult = (input: FinalizeSubmissionSentInput): void => {
  if (
    input.provider.trim().length === 0 ||
    input.remoteMessageId.trim().length === 0 ||
    /[\u0000-\u001f\u007f]/u.test(input.provider) ||
    /[\u0000-\u001f\u007f]/u.test(input.remoteMessageId) ||
    !Number.isFinite(input.acceptedAt.getTime())
  ) {
    invalidFinalization(input.submissionId);
  }
};

const idempotentResult = async (
  tx: MailTransaction,
  input: FinalizeSubmissionSentInput,
  submission: SubmissionRecord,
  email: EmailRecord,
): Promise<FinalizeSubmissionSentResult> => {
  const remote = await tx.emails.findByRemoteId({
    accountId: input.accountId,
    provider: input.provider,
    remoteEmailId: input.remoteMessageId,
  });
  if (
    submission.providerMessageId !== input.remoteMessageId ||
    submission.sentAt === null ||
    email.lifecycle !== 'sent' ||
    email.sentAt === null ||
    remote?.emailId !== email.id ||
    remote.remoteThreadId !== input.remoteThreadId
  ) {
    return invalidFinalization(submission.id);
  }
  return {
    submission,
    email,
    stateVersion: await currentStateVersion(tx, input.accountId),
  };
};

export async function finalizeSubmissionSentInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: FinalizeSubmissionSentInput,
): Promise<FinalizeSubmissionSentResult> {
  requireProviderResult(input);
  await tx.lockAccount(input.accountId);
  const submission = await tx.submissions.findById(input.accountId, input.submissionId);
  if (submission === null) {
    throw new MailCoreError('EMAIL_SUBMISSION_NOT_FOUND', {
      entityId: input.submissionId,
    });
  }
  const email = await tx.emails.findById(input.accountId, submission.emailId);
  if (email === null || email.destroyedAt !== null || email.mailboxIds.length === 0) {
    throw new MailCoreError('EMAIL_NOT_FOUND', { entityId: submission.emailId });
  }
  if (submission.status === 'sent') {
    return idempotentResult(tx, input, submission, email);
  }
  if (submission.status === 'failed' || submission.status === 'canceled') {
    return invalidFinalization(submission.id);
  }
  if (
    email.lifecycle !== 'draft' ||
    email.draftRevision !== submission.draftRevision ||
    email.messageId === null ||
    email.messageId.trim().length === 0
  ) {
    if (email.draftRevision !== submission.draftRevision) {
      throw new MailCoreError('DRAFT_REVISION_CONFLICT', { entityId: email.id });
    }
    throw new MailCoreError('INVALID_EMAIL', { entityId: email.id });
  }

  const submittedBlob = await tx.blobs.findById(input.accountId, submission.rawBlobId);
  if (
    submittedBlob === null ||
    submittedBlob.status !== 'ready' ||
    submittedBlob.readyAt === null ||
    submittedBlob.deletedAt !== null ||
    (submittedBlob.kind !== 'draft_mime' && submittedBlob.kind !== 'message_mime') ||
    submittedBlob.sha256 !== submission.rawSha256 ||
    submittedBlob.sizeBytes !== submission.rawSizeBytes ||
    submittedBlob.objectKey !== submission.rawObjectKey
  ) {
    throw new MailCoreError('BLOB_INTEGRITY', { entityId: email.id });
  }
  const remote = await tx.emails.findByRemoteId({
    accountId: input.accountId,
    provider: input.provider,
    remoteEmailId: input.remoteMessageId,
  });
  if (remote !== null) {
    throw new MailCoreError('IDEMPOTENCY_CONFLICT', { entityId: remote.emailId });
  }

  const mailboxes = await tx.mailboxes.listByAccount(input.accountId);
  const sent = mailboxes.find(({ role, deletedAt }) => role === 'sent' && deletedAt === null);
  if (sent === undefined) {
    throw new MailCoreError('MAILBOX_NOT_FOUND');
  }
  const mailboxById = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  const transientRoles = new Set(['drafts', 'outbox', 'scheduled']);
  const retainedMailboxIds = new Set<MailboxId>();
  for (const mailboxId of email.mailboxIds) {
    const mailbox = mailboxById.get(mailboxId);
    if (mailbox === undefined || mailbox.deletedAt !== null) {
      throw new MailCoreError('MAILBOX_NOT_FOUND', { entityId: mailboxId });
    }
    if (mailbox.role === null || !transientRoles.has(mailbox.role)) {
      retainedMailboxIds.add(mailbox.id);
    }
  }
  retainedMailboxIds.add(sent.id);
  const nextMailboxIds = sortStrings(retainedMailboxIds);
  const nextKeywords = new Set<Keyword>(email.keywords.filter((keyword) => keyword !== '$draft'));
  nextKeywords.add('$seen');
  const nextRestoreMailboxIds = email.restoreMailboxIds.filter((mailboxId) => {
    const mailbox = mailboxById.get(mailboxId);
    return (
      mailbox !== undefined &&
      mailbox.deletedAt === null &&
      (mailbox.role === null || !transientRoles.has(mailbox.role))
    );
  });
  const now = dependencies.clock.now();

  await tx.emails.update(input.accountId, email.id, {
    lifecycle: 'sent',
    blobId: submittedBlob.id,
    parts: email.parts.map((part) => ({ ...part, rawBlobId: submittedBlob.id })),
    sentAt: new Date(input.acceptedAt),
    mailboxIds: nextMailboxIds,
    restoreMailboxIds: sortStrings(new Set(nextRestoreMailboxIds)),
    keywords: sortStrings(nextKeywords),
    updatedAt: new Date(now),
  });
  const updatedEmail = (await tx.emails.findById(input.accountId, email.id))!;
  const aggregateChanges = await applyEmailAggregateDelta(tx, {
    accountId: input.accountId,
    before: email,
    after: updatedEmail,
    now,
  });
  await tx.emails.linkRemote({
    accountId: input.accountId,
    provider: input.provider,
    remoteEmailId: input.remoteMessageId,
    remoteThreadId: input.remoteThreadId,
    emailId: email.id,
    contentFingerprint: submission.rawSha256,
    firstSeenAt: new Date(input.acceptedAt),
    lastSeenAt: new Date(input.acceptedAt),
  });
  const updatedSubmission = await tx.submissions.update(input.accountId, submission.id, {
    status: 'sent',
    providerMessageId: input.remoteMessageId,
    lastErrorCode: null,
    lastErrorMessage: null,
    sentAt: new Date(input.acceptedAt),
    updatedAt: new Date(now),
  });
  const stateVersion = await recordChanges(tx, {
    accountId: input.accountId,
    changes: [
      {
        collection: 'email',
        entityId: email.id,
        changeType: 'updated',
        changedProperties: [
          'lifecycle',
          'blobId',
          'bodyStructure',
          'attachments',
          'sentAt',
          'mailboxIds',
          'restoreMailboxIds',
          'keywords',
        ],
      },
      {
        collection: 'email_submission',
        entityId: submission.id,
        changeType: 'updated',
        changedProperties: [
          'status',
          'providerMessageId',
          'lastErrorCode',
          'lastErrorMessage',
          'sentAt',
        ],
      },
      ...aggregateChanges,
    ],
    createdAt: now,
  });
  await tx.notifications.enqueue({
    eventId: dependencies.idFactory.next<'MailNotification'>(),
    messageId: updatedEmail.id,
    accountId: input.accountId,
    kind: 'sent',
    createCustomerIfMissing: false,
    createdAt: now,
  });
  return { submission: updatedSubmission, email: updatedEmail, stateVersion };
}

export function finalizeSubmissionSent(
  dependencies: MailCoreDependencies,
  input: FinalizeSubmissionSentInput,
): Promise<FinalizeSubmissionSentResult> {
  return dependencies.unitOfWork.run((tx) =>
    finalizeSubmissionSentInTransaction(dependencies, tx, input),
  );
}
