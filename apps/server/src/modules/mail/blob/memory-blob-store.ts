import { MailCoreError, type BlobCommitReceipt, type BlobStore } from '@zero/mail-core';

import {
  buildObjectKey,
  buildObjectPrefix,
  buildTemporaryKey,
  buildTemporaryPrefix,
  bytesEqual,
  calculateSha256,
  copyBytes,
  requireObjectKeyForAccount,
  parseTemporaryKey,
  requireTemporaryKeyForAccount,
} from './blob-key';

type StoredBlob = {
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
  uploadedAt: Date;
};

export class MemoryBlobStore implements BlobStore {
  private readonly temporary = new Map<string, StoredBlob>();
  private readonly objects = new Map<string, StoredBlob>();

  async putTemporary(
    input: Parameters<BlobStore['putTemporary']>[0],
  ): ReturnType<BlobStore['putTemporary']> {
    const temporaryKey = buildTemporaryKey(input.userId, input.accountId, input.kind);
    const bytes = copyBytes(input.bytes);
    const sha256 = await calculateSha256(bytes);
    this.temporary.set(temporaryKey, {
      bytes,
      contentType: input.contentType,
      sha256,
      uploadedAt: new Date(),
    });
    return { temporaryKey, sha256, size: BigInt(bytes.byteLength) };
  }

  async commitTemporary(
    input: Parameters<BlobStore['commitTemporary']>[0],
  ): Promise<BlobCommitReceipt> {
    requireTemporaryKeyForAccount(input.accountId, input.temporaryKey);
    const target = requireObjectKeyForAccount(input.accountId, input.objectKey);
    const temporary = parseTemporaryKey(input.temporaryKey);
    if (temporary.userId !== target.userId || temporary.kind !== target.kind) {
      throw new MailCoreError('BLOB_INTEGRITY');
    }
    const pending = this.temporary.get(input.temporaryKey);
    if (pending === undefined) {
      throw new MailCoreError('BLOB_NOT_FOUND');
    }
    if (
      target.sha256 !== pending.sha256 ||
      input.objectKey !==
        buildObjectKey(target.userId, target.accountId, target.kind, pending.sha256)
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
        uploadedAt: new Date(),
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

  async getRange(input: Parameters<BlobStore['getRange']>[0]): Promise<Uint8Array> {
    const bytes = await this.get(input);
    return bytes.slice(input.offset, input.offset + input.length);
  }

  async delete(input: Parameters<BlobStore['delete']>[0]): Promise<void> {
    requireObjectKeyForAccount(input.accountId, input.objectKey);
    this.objects.delete(input.objectKey);
  }

  async list(input: Parameters<BlobStore['list']>[0]): ReturnType<BlobStore['list']> {
    const prefix =
      input.kind === 'temporary'
        ? buildTemporaryPrefix(input.userId, input.accountId)
        : buildObjectPrefix(input.userId, input.accountId, input.kind);
    const source = input.kind === 'temporary' ? this.temporary : this.objects;
    const entries = [...source.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right));
    const offset = input.cursor === null ? 0 : Number(input.cursor);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(input.limit) ||
      input.limit < 1
    ) {
      throw new MailCoreError('BLOB_STORE_FAILURE');
    }
    const page = entries.slice(offset, offset + input.limit);
    const nextOffset = offset + page.length;
    return {
      entries: page.map(([key, blob]) => ({
        key,
        uploadedAt: new Date(blob.uploadedAt),
        sizeBytes: BigInt(blob.bytes.byteLength),
      })),
      cursor: nextOffset < entries.length ? String(nextOffset) : null,
    };
  }
}
