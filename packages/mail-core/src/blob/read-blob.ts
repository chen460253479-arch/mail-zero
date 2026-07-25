import { MailCoreError, type BlobId, type MailAccountId } from '../types';
import { verifyPreparedBlob } from '../message/blob-lifecycle';
import type { MailCoreDependencies } from '../store';

export type ReadBlobInput = {
  accountId: MailAccountId;
  blobId: BlobId;
};

export type BlobReadAuditEvent = {
  accountId: MailAccountId;
  blobId: BlobId;
  sha256: string;
  sizeBytes: bigint;
  outcome: 'success' | 'integrity_failure';
  occurredAt: Date;
};

export interface BlobReadAuditSink {
  record(event: BlobReadAuditEvent): Promise<void>;
}

export async function readBlob(
  dependencies: MailCoreDependencies,
  input: ReadBlobInput,
): Promise<Uint8Array> {
  const blob = await dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const record = await tx.blobs.findById(input.accountId, input.blobId);
    if (
      record === null ||
      record.status !== 'ready' ||
      record.readyAt === null ||
      record.deletedAt !== null
    ) {
      throw new MailCoreError('BLOB_NOT_FOUND', { entityId: input.blobId });
    }
    return record;
  });

  let bytes: Uint8Array;
  try {
    bytes = await verifyPreparedBlob(
      dependencies.blobStore,
      {
        accountId: input.accountId,
        sha256: blob.sha256,
        sizeBytes: blob.sizeBytes,
      },
      blob.objectKey,
      true,
    );
  } catch (error) {
    if (!(error instanceof MailCoreError) || error.code !== 'BLOB_INTEGRITY') {
      throw error;
    }
    try {
      await dependencies.blobReadAuditSink.record({
        accountId: input.accountId,
        blobId: input.blobId,
        sha256: blob.sha256,
        sizeBytes: blob.sizeBytes,
        outcome: 'integrity_failure',
        occurredAt: dependencies.clock.now(),
      });
    } catch {
      throw new MailCoreError('STORAGE_FAILURE');
    }
    throw error;
  }

  await dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const current = await tx.blobs.findById(input.accountId, input.blobId);
    if (
      current === null ||
      current.status !== 'ready' ||
      current.readyAt === null ||
      current.deletedAt !== null
    ) {
      throw new MailCoreError('BLOB_NOT_FOUND', { entityId: input.blobId });
    }
    if (
      current.sha256 !== blob.sha256 ||
      current.sizeBytes !== blob.sizeBytes ||
      current.objectKey !== blob.objectKey
    ) {
      throw new MailCoreError('BLOB_INTEGRITY');
    }
  });

  try {
    await dependencies.blobReadAuditSink.record({
      accountId: input.accountId,
      blobId: input.blobId,
      sha256: blob.sha256,
      sizeBytes: blob.sizeBytes,
      outcome: 'success',
      occurredAt: dependencies.clock.now(),
    });
  } catch {
    throw new MailCoreError('STORAGE_FAILURE');
  }
  return bytes;
}
