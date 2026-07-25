import { MailCoreError } from '../types';
import type { MailAccountId } from '../types';
import type { BlobStore } from '../store';

interface StoredBlob {
  accountId: MailAccountId;
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
  size: bigint;
}

const copyBytes = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes);

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    copyBytes(bytes),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const copyBlob = (blob: StoredBlob): StoredBlob => ({
  ...blob,
  bytes: copyBytes(blob.bytes),
});

export interface MemoryBlobStoreOptions {
  failCommit?: boolean;
}

export class MemoryBlobStore implements BlobStore {
  private readonly temporary = new Map<string, StoredBlob>();
  private readonly objects = new Map<string, StoredBlob>();
  private readonly failingDeletes = new Set<string>();
  private nextTemporaryKey = 1;
  private failCommit: boolean;

  constructor(options: MemoryBlobStoreOptions = {}) {
    this.failCommit = options.failCommit ?? false;
  }

  async putTemporary(input: {
    accountId: MailAccountId;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ temporaryKey: string; sha256: string; size: bigint }> {
    const bytes = copyBytes(input.bytes);
    const digest = await sha256(bytes);
    const size = BigInt(bytes.byteLength);
    const temporaryKey = `temporary/${this.nextTemporaryKey
      .toString()
      .padStart(8, '0')}`;
    this.nextTemporaryKey += 1;
    this.temporary.set(temporaryKey, {
      accountId: input.accountId,
      bytes,
      contentType: input.contentType,
      sha256: digest,
      size,
    });
    return { temporaryKey, sha256: digest, size };
  }

  async commitTemporary(input: {
    temporaryKey: string;
    objectKey: string;
  }): Promise<void> {
    if (this.failCommit) {
      throw new Error('blob commit failed');
    }
    const pending = this.temporary.get(input.temporaryKey);
    if (pending === undefined) {
      throw new MailCoreError('BLOB_NOT_FOUND');
    }
    const digest = await sha256(pending.bytes);
    if (digest !== pending.sha256 || BigInt(pending.bytes.byteLength) !== pending.size) {
      throw new MailCoreError('BLOB_NOT_FOUND');
    }
    this.objects.set(input.objectKey, copyBlob(pending));
    this.temporary.delete(input.temporaryKey);
  }

  async get(objectKey: string): Promise<Uint8Array> {
    const blob = this.objects.get(objectKey);
    if (blob === undefined) {
      throw new MailCoreError('BLOB_NOT_FOUND');
    }
    return copyBytes(blob.bytes);
  }

  async delete(objectKey: string): Promise<void> {
    if (this.failingDeletes.delete(objectKey)) {
      throw new Error('blob delete failed');
    }
    this.objects.delete(objectKey);
  }

  failNextDelete(objectKey: string): void {
    this.failingDeletes.add(objectKey);
  }

  setFailCommit(fail: boolean): void {
    this.failCommit = fail;
  }

  snapshot(): ReadonlyMap<string, Uint8Array> {
    return new Map(
      [...this.objects].map(([key, blob]) => [key, copyBytes(blob.bytes)]),
    );
  }
}
