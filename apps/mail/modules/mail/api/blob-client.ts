export type UploadedMailBlob = {
  accountId: string;
  blobId: string;
  type: string;
  size: string;
};

export type MailBlobUploadProgress = {
  loaded: number;
  total: number;
  percent: number;
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

export function uploadMailBlobWithProgress({
  accountId,
  file,
  backendBaseUrl,
  onProgress,
  signal,
  xhrFactory = () => new XMLHttpRequest(),
}: MailBlobUrlInput & {
  file: File;
  onProgress?: (progress: MailBlobUploadProgress) => void;
  signal?: AbortSignal;
  xhrFactory?: () => XMLHttpRequest;
}): Promise<UploadedMailBlob> {
  return new Promise((resolve, reject) => {
    const request = xhrFactory();
    const uploadUrl = endpoint(
      backendBaseUrl,
      `/api/mail/accounts/${encodeURIComponent(accountId)}/blobs`,
    );
    const abortError = () => new DOMException('Mail blob upload aborted', 'AbortError');

    const removeAbortListener = () => {
      signal?.removeEventListener('abort', handleSignalAbort);
    };
    const fail = (error: Error) => {
      removeAbortListener();
      reject(error);
    };
    const handleSignalAbort = () => request.abort();

    request.open('POST', uploadUrl);
    request.withCredentials = true;
    request.setRequestHeader('content-type', file.type || 'application/octet-stream');
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress?.({
        loaded: event.loaded,
        total: event.total,
        // Uploading bytes is not the same as the server confirming its S3 write.
        percent: Math.min(95, Math.round((event.loaded / event.total) * 100)),
      });
    };
    request.onerror = () => fail(new Error('MAIL_BLOB_UPLOAD_FAILED:NETWORK'));
    request.onabort = () => fail(abortError());
    request.onload = () => {
      let response: (UploadedMailBlob & { code?: string }) | null = null;
      try {
        response = JSON.parse(request.responseText) as UploadedMailBlob & { code?: string };
      } catch {
        response = null;
      }

      if (request.status < 200 || request.status >= 300 || !response?.blobId) {
        fail(new Error(response?.code ?? `MAIL_BLOB_UPLOAD_FAILED:${request.status}`));
        return;
      }

      removeAbortListener();
      onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
      resolve(response);
    };

    if (signal?.aborted) {
      fail(abortError());
      return;
    }
    signal?.addEventListener('abort', handleSignalAbort, { once: true });
    request.send(file);
  });
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
