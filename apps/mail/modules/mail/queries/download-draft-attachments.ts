import { buildBlobDownloadUrl } from '../api/blob-client';

export type DraftAttachmentDescriptor = {
  blobId: string;
  filename: string;
  contentType: string;
  size: string;
};

export type DownloadedDraftAttachment = {
  blobId: string;
  file: File;
};

export async function downloadDraftAttachments({
  accountId,
  attachments,
  backendBaseUrl,
  signal,
  fetcher = fetch,
}: {
  accountId: string;
  attachments: DraftAttachmentDescriptor[];
  backendBaseUrl: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<DownloadedDraftAttachment[]> {
  for (const attachment of attachments) {
    if (
      !attachment ||
      typeof attachment.blobId !== 'string' ||
      attachment.blobId.length === 0 ||
      typeof attachment.filename !== 'string' ||
      attachment.filename.length === 0
    ) {
      throw new Error('INVALID_DRAFT_ATTACHMENT_DESCRIPTOR');
    }
  }

  return Promise.all(
    attachments.map(async (attachment) => {
      const response = await fetcher(
        buildBlobDownloadUrl({
          accountId,
          blobId: attachment.blobId,
          filename: attachment.filename,
          backendBaseUrl,
        }),
        { credentials: 'include', signal },
      );
      if (!response.ok) {
        throw new Error(`MAIL_BLOB_DOWNLOAD_FAILED:${response.status}`);
      }
      return {
        blobId: attachment.blobId,
        file: new File([await response.blob()], attachment.filename, {
          type: attachment.contentType,
        }),
      };
    }),
  );
}
