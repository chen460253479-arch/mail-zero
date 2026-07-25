import { MailCoreError, type BlobCommitReceipt, type BlobStore } from '@zero/mail-core';

import {
  buildObjectKey,
  buildTemporaryKey,
  bytesEqual,
  calculateSha256,
  copyBytes,
  requireObjectKeyForAccount,
  requireTemporaryKeyForAccount,
} from './blob-key';

type StoredBlob = {
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
};

export class MemoryBlobStore implements BlobStore {
  private readonly temporary = new Map<string, StoredBlob>();
  private readonly objects = new Map<string, StoredBlob>();

  async putTemporary(
    input: Parameters<BlobStore['putTemporary']>[0],
  ): ReturnType<BlobStore['putTemporary']> {
    const temporaryKey = buildTemporaryKey(input.accountId);
    const bytes = copyBytes(input.bytes);
    const sha256 = await calculateSha256(bytes);
    this.temporary.set(temporaryKey, {
      bytes,
      contentType: input.contentType,
      sha256,
    });
    return { temporaryKey, sha256, size: BigInt(bytes.byteLength) };
  }

  async commitTemporary(
    input: Parameters<BlobStore['commitTemporary']>[0],
  ): Promise<BlobCommitReceipt> {
    requireTemporaryKeyForAccount(input.accountId, input.temporaryKey);
    const target = requireObjectKeyForAccount(input.accountId, input.objectKey);
    const pending = this.temporary.get(input.temporaryKey);
    if (pending === undefined) {
      throw new MailCoreError('BLOB_NOT_FOUND');
    }
    if (
      target.sha256 !== pending.sha256 ||
      input.objectKey !== buildObjectKey(target.accountId, pending.sha256)
    ) {
      throw new MailCoreError('BLOB_INTEGRITY');
    }
    const existing = this.objects.get(input.objectKey);
    if (existing !== undefined && !bytesEqual(existing.bytes, pending.bytes)) {
      throw new MailCoreError('BLOB_INTEGRITY');
    }
    if (existing === undefined) {
      this.objects.set(input.objectKey, {
        ...pending,
        bytes: copyBytes(pending.bytes),
      });
    }
    this.temporary.delete(input.temporaryKey);
    return { objectKey: input.objectKey, created: true };
  }

  async deleteTemporary(input: Parameters<BlobStore['deleteTemporary']>[0]): Promise<void> {
    requireTemporaryKeyForAccount(input.accountId, input.temporaryKey);
    this.temporary.delete(input.temporaryKey);
  }

  async get(input: Parameters<BlobStore['get']>[0]): Promise<Uint8Array> {
    requireObjectKeyForAccount(input.accountId, input.objectKey);
    const object = this.objects.get(input.objectKey);
    if (object === undefined) {
      throw new MailCoreError('BLOB_NOT_FOUND');
    }
    return copyBytes(object.bytes);
  }

  async delete(input: Parameters<BlobStore['delete']>[0]): Promise<void> {
    requireObjectKeyForAccount(input.accountId, input.objectKey);
    this.objects.delete(input.objectKey);
  }
}
