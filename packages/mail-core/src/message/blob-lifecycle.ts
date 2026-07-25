import { MailCoreError, type MailAccountId } from '../types';
import type { BlobStore } from '../store';

export type PreparedBlob = {
  temporaryKey: string;
  sha256: string;
  sizeBytes: bigint;
  contentType: string;
};

const copyBytes = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes);

export const calculateSha256 = async (bytes: Uint8Array): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copyBytes(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const requireIntegrity = (
  actualSha256: string,
  actualSize: bigint,
  expectedSha256: string,
  expectedSize: bigint,
): void => {
  if (actualSha256 !== expectedSha256 || actualSize !== expectedSize) {
    throw new MailCoreError('BLOB_INTEGRITY');
  }
};

export async function prepareBlob(
  blobStore: BlobStore,
  input: {
    accountId: MailAccountId;
    bytes: Uint8Array;
    contentType: string;
  },
): Promise<PreparedBlob> {
  const bytes = copyBytes(input.bytes);
  const expectedSha256 = await calculateSha256(bytes);
  const expectedSize = BigInt(bytes.byteLength);
  const pending = await blobStore.putTemporary({
    ...input,
    bytes,
  });

  try {
    requireIntegrity(pending.sha256, pending.size, expectedSha256, expectedSize);
  } catch (error) {
    await blobStore.deleteTemporary(pending.temporaryKey).catch(() => undefined);
    throw error;
  }

  return {
    temporaryKey: pending.temporaryKey,
    sha256: expectedSha256,
    sizeBytes: expectedSize,
    contentType: input.contentType,
  };
}

export async function promoteBlob(
  blobStore: BlobStore,
  prepared: PreparedBlob,
  objectKey: string,
): Promise<void> {
  await blobStore.commitTemporary({
    temporaryKey: prepared.temporaryKey,
    objectKey,
  });
  const committed = await blobStore.get(objectKey);
  requireIntegrity(
    await calculateSha256(committed),
    BigInt(committed.byteLength),
    prepared.sha256,
    prepared.sizeBytes,
  );
}

export async function discardTemporaryBlobs(
  blobStore: BlobStore,
  prepared: PreparedBlob[],
): Promise<void> {
  await Promise.allSettled(
    prepared.map(({ temporaryKey }) => blobStore.deleteTemporary(temporaryKey)),
  );
}

export async function discardCommittedBlobs(
  blobStore: BlobStore,
  objectKeys: string[],
): Promise<void> {
  await Promise.allSettled(objectKeys.map((objectKey) => blobStore.delete(objectKey)));
}
