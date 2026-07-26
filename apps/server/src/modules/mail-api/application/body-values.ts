import type { BlobId, MailAccountId, MailCore } from '@zero/mail-core';

export type BodyValueDto = {
  value: string;
  isTruncated: boolean;
};

const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false });

export async function readBodyValue(
  core: Pick<MailCore, 'readBlobRange'>,
  accountId: MailAccountId,
  blobId: BlobId,
  maxBytes: number,
): Promise<BodyValueDto> {
  const { bytes, isTruncated } = await core.readBlobRange({ accountId, blobId, maxBytes });
  return {
    value: decoder.decode(bytes),
    isTruncated,
  };
}

export async function readBodyText(
  core: Pick<MailCore, 'readBlob'>,
  accountId: MailAccountId,
  blobId: BlobId | null,
): Promise<string> {
  if (blobId === null) return '';
  return decoder.decode(await core.readBlob({ accountId, blobId }));
}
