import type { MailAccountId } from '../types';

export interface BlobStore {
  putTemporary(input: {
    accountId: MailAccountId;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ temporaryKey: string; sha256: string; size: bigint }>;
  commitTemporary(input: {
    temporaryKey: string;
    objectKey: string;
  }): Promise<void>;
  get(objectKey: string): Promise<Uint8Array>;
  delete(objectKey: string): Promise<void>;
}
