import type { BlobRecord, EmailRecord, MailCoreDependencies } from '../store';
import { MailCoreError, type BlobId, type MailAccountId } from '../types';
import { contentAddressedObjectKey } from '../blob/blob-lifecycle';

const MAX_GC_BATCH = 1000;

export type GarbageCollectBlobsInput = {
  accountId: MailAccountId;
  olderThan: Date;
  limit: number;
};

export type GarbageCollectBlobsResult = {
  collectedBlobIds: BlobId[];
};

const referencedBlobIds = (emails: EmailRecord[]): Set<BlobId> => {
  const referenced = new Set<BlobId>();
  for (const email of emails) {
    if (email.blobId !== null) {
      referenced.add(email.blobId);
    }
    if (email.textBlobId !== null) {
      referenced.add(email.textBlobId);
    }
    if (email.htmlBlobId !== null) {
      referenced.add(email.htmlBlobId);
    }
    for (const part of email.parts) {
      if (part.blobId !== null) {
        referenced.add(part.blobId);
      }
    }
  }
  return referenced;
};

export async function garbageCollectBlobs(
  dependencies: MailCoreDependencies,
  input: GarbageCollectBlobsInput,
): Promise<GarbageCollectBlobsResult> {
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_GC_BATCH ||
    Number.isNaN(input.olderThan.getTime())
  ) {
    throw new MailCoreError('INVALID_GC_REQUEST');
  }

  const candidates = await dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const referenced = referencedBlobIds(await tx.emails.listByAccount(input.accountId));
    for (const submission of await tx.submissions.listByAccount(input.accountId)) {
      for (const frozen of submission.frozenBlobs) {
        referenced.add(frozen.blobId);
      }
    }
    const accountBlobs = await tx.blobs.listByAccount(input.accountId);
    const candidatesToMark: BlobRecord[] = accountBlobs
      .filter(
        (blob) =>
          (blob.status === 'ready' || blob.status === 'deleting') &&
          blob.deletedAt === null &&
          blob.createdAt < input.olderThan &&
          !referenced.has(blob.id) &&
          blob.objectKey === contentAddressedObjectKey(input.accountId, blob.sha256),
      )
      .sort((left, right) => {
        const byCreatedAt = left.createdAt.getTime() - right.createdAt.getTime();
        return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt;
      })
      .slice(0, input.limit);
    for (const candidate of candidatesToMark) {
      await tx.blobs.update(input.accountId, candidate.id, {
        status: 'deleting',
      });
    }
    return candidatesToMark;
  });

  const collectedBlobIds: BlobId[] = [];
  for (const candidate of candidates) {
    try {
      await dependencies.blobStore.delete({
        accountId: input.accountId,
        objectKey: candidate.objectKey,
      });
    } catch {
      throw new MailCoreError('BLOB_STORE_FAILURE');
    }
    const finalized = await dependencies.unitOfWork.run(async (tx) => {
      await tx.lockAccount(input.accountId);
      const current = await tx.blobs.findById(input.accountId, candidate.id);
      if (current === null) {
        return false;
      }
      if (
        current.status !== 'deleting' ||
        current.objectKey !== candidate.objectKey ||
        current.objectKey !== contentAddressedObjectKey(input.accountId, current.sha256)
      ) {
        throw new MailCoreError('BLOB_INTEGRITY');
      }
      await tx.blobs.delete(input.accountId, current.id);
      return true;
    });
    if (finalized) {
      collectedBlobIds.push(candidate.id);
    }
  }
  return { collectedBlobIds };
}
