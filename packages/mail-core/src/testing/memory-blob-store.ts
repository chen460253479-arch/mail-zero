import type { BlobCommitReceipt, BlobStore, BlobStoreListPage } from '../store';
import type { MailAccountId } from '../types';
import { MailCoreError } from '../types';

interface StoredBlob {
  accountId: MailAccountId;
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
  size: bigint;
  uploadedAt: Date;
}

const copyBytes = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes);

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const platformCrypto = (
    globalThis as unknown as {
      crypto: {
        subtle: {
          digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
        };
      };
    }
  ).crypto;
  const digest = await platformCrypto.subtle.digest('SHA-256', copyBytes(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const copyBlob = (blob: StoredBlob): StoredBlob => ({
  ...blob,
  bytes: copyBytes(blob.bytes),
  uploadedAt: new Date(blob.uploadedAt),
});

export interface MemoryBlobStoreOptions {
  corruptOnCommit?: 'sha256' | 'size';
  failCommit?: boolean;
  now?: () => Date;
}

export class MemoryBlobStore implements BlobStore {
  private readonly temporary = new Map<string, StoredBlob>();
  private readonly objects = new Map<string, StoredBlob>();
  private readonly failingDeletes = new Set<string>();
  private readonly failingTemporaryDeletes = new Set<string>();
  private nextTemporaryKey = 1;
  private readonly corruptOnCommit: 'sha256' | 'size' | undefined;
  private failCommit: boolean;
  private failCommitAfterPromotionCountdown = 0;
  private readonly now: () => Date;

  constructor(options: MemoryBlobStoreOptions = {}) {
    this.corruptOnCommit = options.corruptOnCommit;
    this.failCommit = options.failCommit ?? false;
    this.now = options.now ?? (() => new Date());
  }

  async putTemporary(input: {
    accountId: MailAccountId;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ temporaryKey: string; sha256: string; size: bigint }> {
    const bytes = copyBytes(input.bytes);
    const digest = await sha256(bytes);
    const size = BigInt(bytes.byteLength);
    const temporaryKey = `temporary/${this.nextTemporaryKey.toString().padStart(8, '0')}`;
    this.nextTemporaryKey += 1;
    this.temporary.set(temporaryKey, {
      accountId: input.accountId,
      bytes,
      contentType: input.contentType,
      sha256: digest,
      size,
      uploadedAt: this.now(),
    });
    return { temporaryKey, sha256: digest, size };
  }

  async commitTemporary(input: {
    accountId: MailAccountId;
    temporaryKey: string;
    objectKey: string;
  }): Promise<BlobCommitReceipt> {
    if (this.failCommit) {
      throw new Error('blob commit failed');
    }
    const pending = this.temporary.get(input.temporaryKey);
    if (pending === undefined) {
      throw new MailCoreError('BLOB_NOT_FOUND');
    }
    if (pending.accountId !== input.accountId) {
      throw new MailCoreError('INVALID_BLOB_KEY');
    }
    const digest = await sha256(pending.bytes);
    if (digest !== pending.sha256 || BigInt(pending.bytes.byteLength) !== pending.size) {
      throw new MailCoreError('BLOB_NOT_FOUND');
    }
    const existing = this.objects.get(input.objectKey);
    if (
      existing !== undefined &&
      (existing.bytes.byteLength !== pending.bytes.byteLength ||
        existing.bytes.some((byte, index) => byte !== pending.bytes[index]))
    ) {
      throw new Error('blob object already exists with different content');
    }
    if (existing !== undefined) {
      this.temporary.delete(input.temporaryKey);
      if (this.acknowledgementFailsNow()) {
        throw new Error('blob commit acknowledgement lost');
      }
      return {
        objectKey: input.objectKey,
        created: true,
      };
    }
    const committed = { ...copyBlob(pending), uploadedAt: this.now() };
    if (this.corruptOnCommit === 'sha256') {
      committed.bytes[0] = (committed.bytes[0] ?? 0) ^ 0xff;
    } else if (this.corruptOnCommit === 'size') {
      const expanded = new Uint8Array(committed.bytes.byteLength + 1);
      expanded.set(committed.bytes);
      committed.bytes = expanded;
    }
    this.objects.set(input.objectKey, committed);
    this.temporary.delete(input.temporaryKey);
    if (this.acknowledgementFailsNow()) {
      throw new Error('blob commit acknowledgement lost');
    }
    return {
      objectKey: input.objectKey,
      created: true,
    };
  }

  async deleteTemporary(input: { accountId: MailAccountId; temporaryKey: string }): Promise<void> {
    const pending = this.temporary.get(input.temporaryKey);
    if (pending !== undefined && pending.accountId !== input.accountId) {
      throw new MailCoreError('INVALID_BLOB_KEY');
    }
    if (this.failingTemporaryDeletes.delete(input.temporaryKey)) {
      throw new Error('temporary blob delete failed');
    }
    this.temporary.delete(input.temporaryKey);
  }

  async get(input: { accountId: MailAccountId; objectKey: string }): Promise<Uint8Array> {
    const blob = this.objects.get(input.objectKey);
    if (blob === undefined || blob.accountId !== input.accountId) {
      throw new MailCoreError('BLOB_NOT_FOUND');
    }
    return copyBytes(blob.bytes);
  }

  async delete(input: { accountId: MailAccountId; objectKey: string }): Promise<void> {
    const blob = this.objects.get(input.objectKey);
    if (blob !== undefined && blob.accountId !== input.accountId) {
      throw new MailCoreError('INVALID_BLOB_KEY');
    }
    if (this.failingDeletes.delete(input.objectKey)) {
      throw new Error('blob delete failed');
    }
    this.objects.delete(input.objectKey);
  }

  async list(input: {
    accountId: MailAccountId;
    kind: 'object' | 'temporary';
    cursor: string | null;
    limit: number;
  }): Promise<BlobStoreListPage> {
    const source = input.kind === 'object' ? this.objects : this.temporary;
    const entries = [...source.entries()]
      .filter(([, blob]) => blob.accountId === input.accountId)
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
        sizeBytes: blob.size,
      })),
      cursor: nextOffset < entries.length ? String(nextOffset) : null,
    };
  }

  failNextDelete(objectKey: string): void {
    this.failingDeletes.add(objectKey);
  }

  failNextTemporaryDelete(temporaryKey: string): void {
    this.failingTemporaryDeletes.add(temporaryKey);
  }

  setFailCommit(fail: boolean): void {
    this.failCommit = fail;
  }

  failNextCommitAfterPromotion(): void {
    this.failCommitAfterPromotions(1);
  }

  failCommitAfterPromotions(count: number): void {
    this.failCommitAfterPromotionCountdown = count;
  }

  snapshot(): ReadonlyMap<string, Uint8Array> {
    return new Map([...this.objects].map(([key, blob]) => [key, copyBytes(blob.bytes)]));
  }

  temporarySnapshot(): ReadonlyMap<string, Uint8Array> {
    return new Map([...this.temporary].map(([key, blob]) => [key, copyBytes(blob.bytes)]));
  }

  private acknowledgementFailsNow(): boolean {
    if (this.failCommitAfterPromotionCountdown === 0) return false;
    this.failCommitAfterPromotionCountdown -= 1;
    return this.failCommitAfterPromotionCountdown === 0;
  }
}
