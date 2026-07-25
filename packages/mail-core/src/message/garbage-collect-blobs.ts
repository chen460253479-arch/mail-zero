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

const selectBatch = async (
  dependencies: MailCoreDependencies,
  input: GarbageCollectBlobsInput,
): Promise<BlobRecord[]> =>
  dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const referenced = referencedBlobIds(await tx.emails.listByAccount(input.accountId));
    const candidates = (await tx.blobs.listByAccount(input.accountId))
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
    for (const blob of candidates) {
      await tx.blobs.update(input.accountId, blob.id, {
        status: 'deleting',
      });
    }
    return candidates;
  });

const restoreReady = async (
  dependencies: MailCoreDependencies,
  accountId: MailAccountId,
  candidates: BlobRecord[],
): Promise<void> => {
  await dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(accountId);
    for (const candidate of candidates) {
      const current = await tx.blobs.findById(accountId, candidate.id);
      if (
        current !== null &&
        current.status === 'deleting' &&
        current.objectKey === candidate.objectKey
      ) {
        await tx.blobs.update(accountId, candidate.id, {
          status: 'ready',
        });
      }
    }
  });
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

  const candidates = await selectBatch(dependencies, input);
  const collectedBlobIds: BlobId[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    try {
      await dependencies.blobStore.delete(candidate.objectKey);
    } catch (error) {
      await restoreReady(dependencies, input.accountId, candidates.slice(index));
      throw error;
    }
    await dependencies.unitOfWork.run(async (tx) => {
      await tx.lockAccount(input.accountId);
      const current = await tx.blobs.findById(input.accountId, candidate.id);
      if (
        current !== null &&
        current.status === 'deleting' &&
        current.objectKey === candidate.objectKey
      ) {
        await tx.blobs.delete(input.accountId, candidate.id);
      }
    });
    collectedBlobIds.push(candidate.id);
  }
  return { collectedBlobIds };
}
