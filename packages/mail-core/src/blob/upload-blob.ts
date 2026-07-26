import {
  commitPreparedBlob,
  contentAddressedObjectKey,
  discardCommittedBlobs,
  discardTemporaryBlobs,
  prepareBlob,
  type PreparedBlob,
  verifyPreparedBlob,
} from './blob-lifecycle';
import type { BlobRecord, MailCoreDependencies, MailTransaction } from '../store';
import { MailCoreError, type BlobId, type MailAccountId } from '../types';

export type UploadBlobInput = {
  accountId: MailAccountId;
  contentType: string;
  bytes: Uint8Array;
};

export type UploadBlobResult = {
  blob: BlobRecord;
  deduplicated: boolean;
};

const currentBlobBytes = async (tx: MailTransaction, accountId: MailAccountId): Promise<bigint> =>
  (await tx.blobs.listByAccount(accountId))
    .filter(
      ({ status, deletedAt }) => deletedAt === null && (status === 'ready' || status === 'pending'),
    )
    .reduce((total, { sizeBytes }) => total + sizeBytes, 0n);

const commitPreparedUpload = async (
  dependencies: MailCoreDependencies,
  prepared: PreparedBlob,
  committedObjectKeys: string[],
  transactionCallbackState: { completed: boolean },
): Promise<UploadBlobResult> =>
  dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(prepared.accountId);
    const account = await tx.accounts.findById(prepared.accountId);
    if (account === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: prepared.accountId });
    }
    if (account.status !== 'active') {
      throw new MailCoreError('ACCOUNT_NOT_ACTIVE', { entityId: prepared.accountId });
    }

    const existing = await tx.blobs.findByDigest(
      prepared.accountId,
      prepared.sha256,
      prepared.sizeBytes,
    );
    if (existing !== null) {
      if (existing.status !== 'ready' || existing.readyAt === null || existing.deletedAt !== null) {
        throw new MailCoreError('BLOB_INTEGRITY', { entityId: existing.id });
      }
      await verifyPreparedBlob(dependencies.blobStore, prepared, existing.objectKey, true);
      return { blob: existing, deduplicated: true };
    }

    if (
      account.storageQuotaBytes !== null &&
      (await currentBlobBytes(tx, prepared.accountId)) + prepared.sizeBytes >
        account.storageQuotaBytes
    ) {
      throw new MailCoreError('OVER_QUOTA');
    }

    const now = dependencies.clock.now();
    const blobId = dependencies.idFactory.next<'Blob'>() as BlobId;
    const pending = await tx.blobs.insert({
      id: blobId,
      accountId: prepared.accountId,
      sha256: prepared.sha256,
      sizeBytes: prepared.sizeBytes,
      contentType: prepared.contentType,
      objectKey: contentAddressedObjectKey(prepared.accountId, prepared.sha256),
      status: 'pending',
      createdAt: now,
      readyAt: null,
      deletedAt: null,
    });

    committedObjectKeys.push(pending.objectKey);
    const receipt = await commitPreparedBlob(dependencies.blobStore, prepared, pending.objectKey);
    await verifyPreparedBlob(dependencies.blobStore, prepared, receipt.objectKey);
    const ready = await tx.blobs.update(prepared.accountId, pending.id, {
      status: 'ready',
      readyAt: now,
    });
    transactionCallbackState.completed = true;
    return { blob: ready, deduplicated: false };
  });

export async function uploadBlob(
  dependencies: MailCoreDependencies,
  input: UploadBlobInput,
): Promise<UploadBlobResult> {
  const prepared = await prepareBlob(dependencies.blobStore, input);
  const committedObjectKeys: string[] = [];
  const transactionCallbackState = { completed: false };
  try {
    return await commitPreparedUpload(
      dependencies,
      prepared,
      committedObjectKeys,
      transactionCallbackState,
    );
  } catch (error) {
    if (!transactionCallbackState.completed) {
      await discardCommittedBlobs(dependencies.blobStore, prepared.accountId, committedObjectKeys);
    }
    throw error;
  } finally {
    await discardTemporaryBlobs(dependencies.blobStore, [prepared]);
  }
}
