import type { SubmissionRecord, MailCoreDependencies, MailTransaction } from '../store';
import type { CreateSubmissionInput } from './types';
import type { EmailSubmissionId } from '../types';
import { MailCoreError } from '../types';

const normalizeRequestedSendAt = (sendAt: Date | null): Date | null => {
  if (sendAt === null) {
    return null;
  }
  const normalized = new Date(sendAt);
  if (!Number.isFinite(normalized.getTime())) {
    throw new MailCoreError('INVALID_SUBMISSION_TRANSITION');
  }
  return normalized;
};

const isExactRetry = (
  existing: SubmissionRecord,
  input: CreateSubmissionInput,
  draftRevision: number,
  requestedSendAt: Date | null,
): boolean => {
  const sameSchedule =
    requestedSendAt === null
      ? existing.sendAt.getTime() === existing.createdAt.getTime()
      : existing.sendAt.getTime() === requestedSendAt.getTime();
  return (
    existing.emailId === input.emailId &&
    existing.identityId === input.identityId &&
    existing.draftRevision === draftRevision &&
    sameSchedule
  );
};

const throwMissingOrCrossAccount = async (
  tx: MailTransaction,
  input: CreateSubmissionInput,
  kind: 'email' | 'identity',
): Promise<never> => {
  const outside =
    kind === 'email'
      ? await tx.emails.existsOutsideAccount(input.accountId, input.emailId)
      : await tx.identities.existsOutsideAccount(input.accountId, input.identityId);
  if (outside) {
    throw new MailCoreError('CROSS_ACCOUNT_REFERENCE', {
      entityId: kind === 'email' ? input.emailId : input.identityId,
    });
  }
  throw new MailCoreError(kind === 'email' ? 'EMAIL_NOT_FOUND' : 'IDENTITY_NOT_FOUND', {
    entityId: kind === 'email' ? input.emailId : input.identityId,
  });
};

export async function createSubmission(
  dependencies: MailCoreDependencies,
  input: CreateSubmissionInput,
): Promise<SubmissionRecord> {
  const requestedSendAt = normalizeRequestedSendAt(input.sendAt);
  if (input.idempotencyKey.length === 0) {
    throw new MailCoreError('IDEMPOTENCY_CONFLICT');
  }

  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const now = dependencies.clock.now();
    const sendAt = requestedSendAt === null ? new Date(now) : requestedSendAt;
    const email = await tx.emails.findById(input.accountId, input.emailId);
    if (email === null) {
      return throwMissingOrCrossAccount(tx, input, 'email');
    }
    const identity = await tx.identities.findById(input.accountId, input.identityId);
    if (identity === null) {
      return throwMissingOrCrossAccount(tx, input, 'identity');
    }

    const existing = await tx.submissions.findByIdempotencyKey(
      input.accountId,
      input.idempotencyKey,
    );
    if (existing !== null) {
      if (isExactRetry(existing, input, email.draftRevision, requestedSendAt)) {
        return existing;
      }
      throw new MailCoreError('IDEMPOTENCY_CONFLICT', { entityId: existing.id });
    }

    if (
      email.destroyedAt !== null ||
      email.mailboxIds.length === 0 ||
      email.lifecycle !== 'draft' ||
      email.identityId !== identity.id
    ) {
      throw new MailCoreError(
        email.destroyedAt !== null || email.mailboxIds.length === 0
          ? 'EMAIL_NOT_FOUND'
          : 'INVALID_EMAIL',
        { entityId: email.id },
      );
    }
    if (email.blobId === null) {
      throw new MailCoreError('BLOB_NOT_FOUND', { entityId: email.id });
    }
    const rawBlob = await tx.blobs.findById(input.accountId, email.blobId);
    if (rawBlob === null || rawBlob.status !== 'ready') {
      throw new MailCoreError('BLOB_NOT_FOUND', { entityId: email.blobId });
    }
    if (email.to.length + email.cc.length + email.bcc.length === 0) {
      throw new MailCoreError('INVALID_EMAIL', { entityId: email.id });
    }

    const submission = await tx.submissions.insert({
      id: dependencies.idFactory.next<'EmailSubmission'>() as EmailSubmissionId,
      accountId: input.accountId,
      emailId: email.id,
      identityId: identity.id,
      status: sendAt.getTime() <= now.getTime() ? 'queued' : 'scheduled',
      sendAt,
      idempotencyKey: input.idempotencyKey,
      draftRevision: email.draftRevision,
      attemptCount: 0,
      nextAttemptAt: null,
      providerMessageId: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
      sentAt: null,
    });
    const stateVersion = await tx.nextStateVersion(input.accountId);
    await tx.changes.recordChange({
      accountId: input.accountId,
      stateVersion,
      collection: 'email_submission',
      entityId: submission.id,
      changeType: 'created',
      changedProperties: null,
      createdAt: now,
    });
    return submission;
  });
}
