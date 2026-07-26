import { MailCoreError, type BlobId, type MailAccountId } from '../types';
import type { MailCoreDependencies } from '../store';
import { readBlob } from './read-blob';
import { getBlob } from './get-blob';

export type ReadBlobRangeInput = {
  accountId: MailAccountId;
  blobId: BlobId;
  maxBytes: number;
};

export async function readBlobRange(
  dependencies: MailCoreDependencies,
  input: ReadBlobRangeInput,
): Promise<{ bytes: Uint8Array; isTruncated: boolean }> {
  if (!Number.isInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > 1_000_000) {
    throw new MailCoreError('INVALID_QUERY');
  }
  const blob = await getBlob(dependencies, input);
  if (blob.sizeBytes <= BigInt(input.maxBytes)) {
    return { bytes: await readBlob(dependencies, input), isTruncated: false };
  }
  const bytes = await dependencies.blobStore.getRange({
    accountId: input.accountId,
    objectKey: blob.objectKey,
    offset: 0,
    length: input.maxBytes,
  });
  return { bytes, isTruncated: true };
}
