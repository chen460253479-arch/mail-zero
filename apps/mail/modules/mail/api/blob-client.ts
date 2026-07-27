export type UploadedMailBlob = {
  accountId: string;
  blobId: string;
  type: string;
  size: string;
};

type MailBlobUrlInput = {
  accountId: string;
  backendBaseUrl: string;
};

const endpoint = (backendBaseUrl: string, path: string) =>
  `${backendBaseUrl.replace(/\/+$/u, '')}${path}`;

export async function uploadMailBlob({
  accountId,
  file,
  backendBaseUrl,
  fetcher = fetch,
}: MailBlobUrlInput & {
  file: File;
  fetcher?: typeof fetch;
}): Promise<UploadedMailBlob> {
  const response = await fetcher(
    endpoint(backendBaseUrl, `/api/mail/accounts/${encodeURIComponent(accountId)}/blobs`),
    {
      method: 'POST',
      body: file,
      credentials: 'include',
      headers: {
        'content-type': file.type || 'application/octet-stream',
      },
    },
  );
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { code?: string } | null;
    throw new Error(error?.code ?? `MAIL_BLOB_UPLOAD_FAILED:${response.status}`);
  }
  return (await response.json()) as UploadedMailBlob;
}

export function buildBlobDownloadUrl({
  accountId,
  blobId,
  filename,
  backendBaseUrl,
}: MailBlobUrlInput & {
  blobId: string;
  filename: string;
}) {
  return endpoint(
    backendBaseUrl,
    `/api/mail/accounts/${encodeURIComponent(accountId)}/blobs/${encodeURIComponent(blobId)}/${encodeURIComponent(filename)}`,
  );
}
