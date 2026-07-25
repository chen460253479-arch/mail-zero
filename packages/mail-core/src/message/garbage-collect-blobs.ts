import type { BlobRecord, EmailRecord, MailCoreDependencies } from '../store';
import { MailCoreError, type BlobId, type MailAccountId } from '../types';

const MAX_GC_BATCH = 1000;

export type GarbageCollectBlobsInput = {
  accountId: MailAccountId;
  olderThan: Date;
  limit: number;
};

export type GarbageCollectBlobsResult = {
  collectedBlobIds: BlobId[];
};

const canonicalObjectKey = (accountId: MailAccountId, blobId: BlobId): string =>
  `mail/${accountId}/blobs/${blobId}`;

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

  const result = await dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const referenced = referencedBlobIds(await tx.emails.listByAccount(input.accountId));
    const candidates: BlobRecord[] = (await tx.blobs.listByAccount(input.accountId))
      .filter(
        (blob) =>
          (blob.status === 'ready' || blob.status === 'deleting') &&
          blob.deletedAt === null &&
          blob.createdAt < input.olderThan &&
          !referenced.has(blob.id) &&
          blob.objectKey === canonicalObjectKey(input.accountId, blob.id),
      )
      .sort((left, right) => {
        const byCreatedAt = left.createdAt.getTime() - right.createdAt.getTime();
        return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt;
      })
      .slice(0, input.limit);
    for (const candidate of candidates) {
      await tx.blobs.update(input.accountId, candidate.id, {
        status: 'deleting',
      });
    }

    const collectedBlobIds: BlobId[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]!;
      try {
        await dependencies.blobStore.delete(candidate.objectKey);
      } catch {
        for (const retryable of candidates.slice(index)) {
          await tx.blobs.update(input.accountId, retryable.id, {
            status: 'ready',
          });
        }
        return { collectedBlobIds, deleteFailed: true as const };
      }
      await tx.blobs.delete(input.accountId, candidate.id);
      collectedBlobIds.push(candidate.id);
    }
    return { collectedBlobIds, deleteFailed: false as const };
  });
  if (result.deleteFailed) {
    throw new MailCoreError('BLOB_STORE_FAILURE');
  }
  return { collectedBlobIds: result.collectedBlobIds };
}
