import type { MailAccountId } from '../types';

export type BlobCommitReceipt = {
  objectKey: string;
  created: true;
};

export interface BlobStore {
  putTemporary(input: {
    accountId: MailAccountId;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ temporaryKey: string; sha256: string; size: bigint }>;
  commitTemporary(input: { temporaryKey: string; objectKey: string }): Promise<BlobCommitReceipt>;
  deleteTemporary(temporaryKey: string): Promise<void>;
  get(objectKey: string): Promise<Uint8Array>;
  /**
   * Permanently deletes an object. Implementations must be idempotent: an
   * already-missing object is a successful deletion, including on retries.
   */
  delete(objectKey: string): Promise<void>;
}
