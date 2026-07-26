import { MailCoreError, type MailAccountId } from '../types';
import type { BlobCommitReceipt, BlobStore } from '../store';

export type PreparedBlob = {
  accountId: MailAccountId;
  temporaryKey: string;
  sha256: string;
  sizeBytes: bigint;
  contentType: string;
};

export const contentAddressedObjectKey = (accountId: MailAccountId, sha256: string): string =>
  `mail/${accountId}/sha256/${sha256.slice(0, 2)}/${sha256}`;

const copyBytes = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes);

export const calculateSha256 = async (bytes: Uint8Array): Promise<string> => {
  const platformCrypto = (
    globalThis as unknown as {
      crypto?: {
        subtle: {
          digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
        };
      };
    }
  ).crypto;
  if (platformCrypto === undefined) {
    throw new MailCoreError('BLOB_STORE_FAILURE');
  }
  const digest = await platformCrypto.subtle.digest('SHA-256', copyBytes(bytes));
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

const safeBlobStoreError = (error: unknown): MailCoreError =>
  error instanceof MailCoreError
    ? new MailCoreError(error.code)
    : new MailCoreError('BLOB_STORE_FAILURE');

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
  let pending: Awaited<ReturnType<BlobStore['putTemporary']>>;
  try {
    pending = await blobStore.putTemporary({
      ...input,
      bytes,
    });
  } catch (error) {
    throw safeBlobStoreError(error);
  }

  try {
    requireIntegrity(pending.sha256, pending.size, expectedSha256, expectedSize);
  } catch (error) {
    await blobStore
      .deleteTemporary({
        accountId: input.accountId,
        temporaryKey: pending.temporaryKey,
      })
      .catch(() => undefined);
    throw error;
  }

  return {
    accountId: input.accountId,
    temporaryKey: pending.temporaryKey,
    sha256: expectedSha256,
    sizeBytes: expectedSize,
    contentType: input.contentType,
  };
}

export async function commitPreparedBlob(
  blobStore: BlobStore,
  prepared: PreparedBlob,
  objectKey: string,
): Promise<BlobCommitReceipt> {
  try {
    const receipt = await blobStore.commitTemporary({
      accountId: prepared.accountId,
      temporaryKey: prepared.temporaryKey,
      objectKey,
    });
    if (receipt.created !== true || receipt.objectKey !== objectKey) {
      throw new MailCoreError('BLOB_STORE_FAILURE');
    }
    return receipt;
  } catch (error) {
    throw safeBlobStoreError(error);
  }
}

export async function verifyPreparedBlob(
  blobStore: BlobStore,
  prepared: Pick<PreparedBlob, 'accountId' | 'sha256' | 'sizeBytes'>,
  objectKey: string,
  missingIsIntegrityFailure = false,
): Promise<Uint8Array> {
  let committed: Uint8Array;
  try {
    committed = await blobStore.get({
      accountId: prepared.accountId,
      objectKey,
    });
  } catch (error) {
    if (
      missingIsIntegrityFailure &&
      error instanceof MailCoreError &&
      error.code === 'BLOB_NOT_FOUND'
    ) {
      throw new MailCoreError('BLOB_INTEGRITY');
    }
    throw safeBlobStoreError(error);
  }
  requireIntegrity(
    await calculateSha256(committed),
    BigInt(committed.byteLength),
    prepared.sha256,
    prepared.sizeBytes,
  );
  return committed;
}

export async function discardTemporaryBlobs(
  blobStore: BlobStore,
  prepared: PreparedBlob[],
): Promise<void> {
  await Promise.allSettled(
    prepared.map(({ accountId, temporaryKey }) =>
      blobStore.deleteTemporary({ accountId, temporaryKey }),
    ),
  );
}

export async function discardCommittedBlobs(
  blobStore: BlobStore,
  accountId: MailAccountId,
  objectKeys: string[],
): Promise<void> {
  await Promise.allSettled(
    objectKeys.map((objectKey) => blobStore.delete({ accountId, objectKey })),
  );
}
