import type { MailAccountId } from '../types';

export type BlobCommitReceipt = {
  objectKey: string;
  created: true;
};

export type BlobStoreEntry = {
  key: string;
  uploadedAt: Date;
  sizeBytes: bigint;
};

export type BlobStoreListPage = {
  entries: BlobStoreEntry[];
  cursor: string | null;
};

export interface BlobStore {
  putTemporary(input: {
    accountId: MailAccountId;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ temporaryKey: string; sha256: string; size: bigint }>;
  commitTemporary(input: {
    accountId: MailAccountId;
    temporaryKey: string;
    objectKey: string;
  }): Promise<BlobCommitReceipt>;
  deleteTemporary(input: { accountId: MailAccountId; temporaryKey: string }): Promise<void>;
  get(input: { accountId: MailAccountId; objectKey: string }): Promise<Uint8Array>;
  getRange(input: {
    accountId: MailAccountId;
    objectKey: string;
    offset: number;
    length: number;
  }): Promise<Uint8Array>;
  /**
   * Permanently deletes an object. Implementations must be idempotent: an
   * already-missing object is a successful deletion, including on retries.
   */
  delete(input: { accountId: MailAccountId; objectKey: string }): Promise<void>;
  /**
   * Enumerates only keys owned by the supplied account. Cursors are opaque and
   * may only be reused with the same account and kind.
   */
  list(input: {
    accountId: MailAccountId;
    kind: 'object' | 'temporary';
    cursor: string | null;
    limit: number;
  }): Promise<BlobStoreListPage>;
}
