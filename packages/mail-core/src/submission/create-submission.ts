import {
  commitPreparedBlob,
  contentAddressedObjectKey,
  discardCommittedBlobs,
  discardTemporaryBlobs,
  prepareBlob,
  type PreparedBlob,
  verifyPreparedBlob,
} from '../blob/blob-lifecycle';
import type { BlobRecord, SubmissionRecord, MailCoreDependencies, MailTransaction } from '../store';
import type { BlobId, EmailSubmissionId } from '../types';
import type { CreateSubmissionInput } from './types';
import { MailCoreError } from '../types';
import { z } from 'zod';

export type PreparedSubmission = {
  raw: PreparedBlob;
};

const recipientSchema = z.string().email();

const requireValidRecipients = (
  email: NonNullable<Awaited<ReturnType<MailTransaction['emails']['findById']>>>,
) => {
  for (const address of [...email.to, ...email.cc, ...email.bcc]) {
    if (
      !recipientSchema.safeParse(address.email).success ||
      (address.name !== undefined && /[\r\n]/u.test(address.name))
    ) {
      throw new MailCoreError('INVALID_EMAIL', { entityId: email.id });
    }
  }
};

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
  requestedSendAt: Date | null,
): boolean => {
  const sameSchedule =
    requestedSendAt === null
      ? existing.sendAt.getTime() === existing.createdAt.getTime()
      : existing.sendAt.getTime() === requestedSendAt.getTime();
  return (
    existing.emailId === input.emailId && existing.identityId === input.identityId && sameSchedule
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

const requireFrozenBlob = async (
  tx: MailTransaction,
  accountId: CreateSubmissionInput['accountId'],
  blobId: NonNullable<Awaited<ReturnType<MailTransaction['emails']['findById']>>>['blobId'],
): Promise<BlobRecord> => {
  if (blobId === null) {
    throw new MailCoreError('BLOB_NOT_FOUND');
  }
  const blob: BlobRecord | null = await tx.blobs.findById(accountId, blobId);
  if (
    blob === null ||
    blob.status !== 'ready' ||
    blob.deletedAt !== null ||
    blob.kind !== 'draft_mime' ||
    blob.contentType !== 'message/rfc822'
  ) {
    throw new MailCoreError('BLOB_NOT_FOUND', { entityId: blobId });
  }
  return blob;
};

export async function prepareSubmission(
  dependencies: MailCoreDependencies,
  input: CreateSubmissionInput,
): Promise<PreparedSubmission> {
  const source = await dependencies.unitOfWork.run(async (tx) => {
    const account = await tx.accounts.findById(input.accountId);
    if (account === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    const email = await tx.emails.findById(input.accountId, input.emailId);
    if (email === null) {
      if (await tx.emails.existsOutsideAccount(input.accountId, input.emailId)) {
        throw new MailCoreError('CROSS_ACCOUNT_REFERENCE', { entityId: input.emailId });
      }
      throw new MailCoreError('EMAIL_NOT_FOUND', { entityId: input.emailId });
    }
    if (email.blobId === null) {
      throw new MailCoreError('BLOB_NOT_FOUND', { entityId: input.emailId });
    }
    const blob = await requireFrozenBlob(tx, input.accountId, email.blobId);
    return { account, blob };
  });
  const bytes = await verifyPreparedBlob(
    dependencies.blobStore,
    {
      accountId: input.accountId,
      sha256: source.blob.sha256,
      sizeBytes: source.blob.sizeBytes,
    },
    source.blob.objectKey,
    true,
  );
  return {
    raw: await prepareBlob(dependencies.blobStore, {
      userId: source.account.userId,
      accountId: input.accountId,
      kind: 'message_mime',
      bytes,
      contentType: 'message/rfc822',
    }),
  };
}

const allocateSubmissionBlob = async (
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  prepared: PreparedBlob,
  storageQuotaBytes: bigint | null,
  committedObjectKeys: string[],
): Promise<BlobRecord> => {
  const existing = await tx.blobs.findByDigest(
    prepared.accountId,
    prepared.kind,
    prepared.sha256,
    prepared.sizeBytes,
  );
  if (existing !== null) {
    if (
      existing.status !== 'ready' ||
      existing.readyAt === null ||
      existing.deletedAt !== null ||
      existing.kind !== 'message_mime'
    ) {
      throw new MailCoreError('BLOB_INTEGRITY', { entityId: existing.id });
    }
    await verifyPreparedBlob(dependencies.blobStore, prepared, existing.objectKey, true);
    return existing;
  }

  if (storageQuotaBytes !== null) {
    const currentBytes = (await tx.blobs.listByAccount(prepared.accountId))
      .filter(
        ({ deletedAt, status }) =>
          deletedAt === null && (status === 'ready' || status === 'pending'),
      )
      .reduce((total, { sizeBytes }) => total + sizeBytes, 0n);
    if (currentBytes + prepared.sizeBytes > storageQuotaBytes) {
      throw new MailCoreError('OVER_QUOTA');
    }
  }

  const now = dependencies.clock.now();
  const pending = await tx.blobs.insert({
    id: dependencies.idFactory.next<'Blob'>() as BlobId,
    accountId: prepared.accountId,
    kind: prepared.kind,
    sha256: prepared.sha256,
    sizeBytes: prepared.sizeBytes,
    contentType: prepared.contentType,
    objectKey: contentAddressedObjectKey(
      prepared.userId,
      prepared.accountId,
      prepared.kind,
      prepared.sha256,
    ),
    status: 'pending',
    createdAt: now,
    readyAt: null,
    deletedAt: null,
  });
  committedObjectKeys.push(pending.objectKey);
  const receipt = await commitPreparedBlob(dependencies.blobStore, prepared, pending.objectKey);
  await verifyPreparedBlob(dependencies.blobStore, prepared, receipt.objectKey);
  return tx.blobs.update(prepared.accountId, pending.id, {
    status: 'ready',
    readyAt: now,
  });
};

export async function createSubmissionInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: CreateSubmissionInput,
  prepared: PreparedSubmission,
  committedObjectKeys: string[],
): Promise<SubmissionRecord> {
  const requestedSendAt = normalizeRequestedSendAt(input.sendAt);
  if (input.idempotencyKey.length === 0) {
    throw new MailCoreError('IDEMPOTENCY_CONFLICT');
  }

  await tx.lockAccount(input.accountId);
  const account = await tx.accounts.findById(input.accountId);
  if (account === null) {
    throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
  }
  if (account.userId !== prepared.raw.userId || prepared.raw.kind !== 'message_mime') {
    throw new MailCoreError('BLOB_INTEGRITY', { entityId: input.accountId });
  }
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

  const existing = await tx.submissions.findByIdempotencyKey(input.accountId, input.idempotencyKey);
  if (existing !== null) {
    if (isExactRetry(existing, input, requestedSendAt)) {
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
  const frozenRaw = await requireFrozenBlob(tx, input.accountId, email.blobId);
  if (frozenRaw.sha256 !== prepared.raw.sha256 || frozenRaw.sizeBytes !== prepared.raw.sizeBytes) {
    throw new MailCoreError('DRAFT_REVISION_CONFLICT', { entityId: email.id });
  }
  if (email.to.length + email.cc.length + email.bcc.length === 0) {
    throw new MailCoreError('INVALID_EMAIL', { entityId: email.id });
  }
  requireValidRecipients(email);
  const messageRaw = await allocateSubmissionBlob(
    dependencies,
    tx,
    prepared.raw,
    account.storageQuotaBytes,
    committedObjectKeys,
  );

  const submission = await tx.submissions.insert({
    id: dependencies.idFactory.next<'EmailSubmission'>() as EmailSubmissionId,
    accountId: input.accountId,
    emailId: email.id,
    identityId: identity.id,
    status: sendAt.getTime() <= now.getTime() ? 'queued' : 'scheduled',
    sendAt,
    idempotencyKey: input.idempotencyKey,
    draftRevision: email.draftRevision,
    rawBlobId: messageRaw.id,
    rawSha256: messageRaw.sha256,
    rawSizeBytes: messageRaw.sizeBytes,
    rawObjectKey: messageRaw.objectKey,
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
}

export async function createSubmission(
  dependencies: MailCoreDependencies,
  input: CreateSubmissionInput,
): Promise<SubmissionRecord> {
  const prepared = await prepareSubmission(dependencies, input);
  const committedObjectKeys: string[] = [];
  let completed = false;
  try {
    const submission = await dependencies.unitOfWork.run(async (tx) => {
      const created = await createSubmissionInTransaction(
        dependencies,
        tx,
        input,
        prepared,
        committedObjectKeys,
      );
      completed = true;
      return created;
    });
    return submission;
  } catch (error) {
    if (!completed) {
      await discardCommittedBlobs(dependencies.blobStore, input.accountId, committedObjectKeys);
    }
    throw error;
  } finally {
    await discardTemporaryBlobs(dependencies.blobStore, [prepared.raw]);
  }
}
