import { MailCoreError, type BlobId, type MailAccountId } from '../types';
import type { BlobRecord, MailCoreDependencies } from '../store';

export type GetBlobInput = {
  accountId: MailAccountId;
  blobId: BlobId;
};

export async function getBlob(
  dependencies: Pick<MailCoreDependencies, 'unitOfWork'>,
  input: GetBlobInput,
): Promise<BlobRecord> {
  return dependencies.unitOfWork.run(async (tx) => {
    if ((await tx.accounts.findById(input.accountId)) === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    const blob = await tx.blobs.findById(input.accountId, input.blobId);
    if (
      blob === null ||
      blob.status !== 'ready' ||
      blob.readyAt === null ||
      blob.deletedAt !== null
    ) {
      throw new MailCoreError('BLOB_NOT_FOUND', { entityId: input.blobId });
    }
    return blob;
  });
}
