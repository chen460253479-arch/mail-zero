import type { EmailPartRecord, MailCoreDependencies } from '../store';
import { MailCoreError, type EmailId, type MailAccountId } from '../types';
import { decodeMimeSection } from './mime-section-index';

export type ReadEmailPartInput = {
  accountId: MailAccountId;
  emailId: EmailId;
  partId: string;
};

export type ReadEmailPartByIdInput = Omit<ReadEmailPartInput, 'emailId'>;

export type ReadEmailPartResult = {
  bytes: Uint8Array;
  contentType: string;
  disposition: EmailPartRecord['disposition'];
  filename: string | null;
  contentId: string | null;
  sizeBytes: bigint;
};

const safeRangeNumber = (value: bigint): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MailCoreError('BLOB_INTEGRITY');
  }
  return Number(value);
};

const recordReadAudit = async (
  dependencies: MailCoreDependencies,
  input: ReadEmailPartInput,
  blob: {
    id: EmailPartRecord['rawBlobId'];
    sha256: string;
    sizeBytes: bigint;
  },
  outcome: 'success' | 'integrity_failure',
): Promise<void> => {
  try {
    await dependencies.blobReadAuditSink.record({
      accountId: input.accountId,
      blobId: blob.id,
      sha256: blob.sha256,
      sizeBytes: blob.sizeBytes,
      outcome,
      occurredAt: dependencies.clock.now(),
    });
  } catch {
    throw new MailCoreError('STORAGE_FAILURE');
  }
};

export async function readEmailPart(
  dependencies: MailCoreDependencies,
  input: ReadEmailPartInput,
): Promise<ReadEmailPartResult> {
  const { part, blob } = await dependencies.unitOfWork.run(async (tx) => {
    if ((await tx.accounts.findById(input.accountId)) === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    const email = await tx.emails.findById(input.accountId, input.emailId);
    if (email === null || email.destroyedAt !== null || email.mailboxIds.length === 0) {
      if (await tx.emails.existsOutsideAccount(input.accountId, input.emailId)) {
        throw new MailCoreError('CROSS_ACCOUNT_REFERENCE', { entityId: input.emailId });
      }
      throw new MailCoreError('EMAIL_NOT_FOUND', { entityId: input.emailId });
    }
    const selected = email.parts.find(({ id }) => id === input.partId);
    if (selected === undefined) {
      throw new MailCoreError('BLOB_NOT_FOUND', { entityId: input.partId });
    }
    const rawBlob = await tx.blobs.findById(input.accountId, selected.rawBlobId);
    if (
      email.blobId !== selected.rawBlobId ||
      rawBlob === null ||
      rawBlob.status !== 'ready' ||
      rawBlob.readyAt === null ||
      rawBlob.deletedAt !== null ||
      rawBlob.contentType !== 'message/rfc822'
    ) {
      throw new MailCoreError('BLOB_INTEGRITY', { entityId: selected.rawBlobId });
    }
    if (
      selected.offsetStart < 0n ||
      selected.encodedLength < 0n ||
      selected.decodedLength < 0n ||
      selected.offsetStart + selected.encodedLength > rawBlob.sizeBytes
    ) {
      throw new MailCoreError('BLOB_INTEGRITY', { entityId: selected.id });
    }
    return { part: selected, blob: rawBlob };
  });

  const offset = safeRangeNumber(part.offsetStart);
  const length = safeRangeNumber(part.encodedLength);
  let encoded: Uint8Array;
  try {
    encoded =
      length === 0
        ? new Uint8Array()
        : await dependencies.blobStore.getRange({
            accountId: input.accountId,
            objectKey: blob.objectKey,
            offset,
            length,
          });
  } catch (error) {
    const failure =
      error instanceof MailCoreError && error.code === 'BLOB_NOT_FOUND'
        ? new MailCoreError('BLOB_INTEGRITY')
        : error instanceof MailCoreError
          ? new MailCoreError(error.code)
          : new MailCoreError('BLOB_STORE_FAILURE');
    if (failure.code === 'BLOB_INTEGRITY') {
      await recordReadAudit(dependencies, input, blob, 'integrity_failure');
    }
    throw failure;
  }

  let bytes: Uint8Array;
  try {
    if (encoded.byteLength !== length) {
      throw new MailCoreError('BLOB_INTEGRITY');
    }
    bytes = decodeMimeSection(encoded, part.transferEncoding);
    if (BigInt(bytes.byteLength) !== part.decodedLength) {
      throw new MailCoreError('BLOB_INTEGRITY');
    }
  } catch {
    await recordReadAudit(dependencies, input, blob, 'integrity_failure');
    throw new MailCoreError('BLOB_INTEGRITY');
  }

  await recordReadAudit(dependencies, input, blob, 'success');
  return {
    bytes,
    contentType: part.contentType,
    disposition: part.disposition,
    filename: part.filename,
    contentId: part.contentId,
    sizeBytes: part.decodedLength,
  };
}

export async function readEmailPartById(
  dependencies: MailCoreDependencies,
  input: ReadEmailPartByIdInput,
): Promise<ReadEmailPartResult> {
  const located = await dependencies.unitOfWork.run(async (tx) => {
    if ((await tx.accounts.findById(input.accountId)) === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    return tx.emails.findPartById(input.accountId, input.partId);
  });
  if (located === null) {
    throw new MailCoreError('BLOB_NOT_FOUND', { entityId: input.partId });
  }
  return readEmailPart(dependencies, {
    ...input,
    emailId: located.emailId,
  });
}
