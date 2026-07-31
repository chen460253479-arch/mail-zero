import { describe, expect, it, vi } from 'vitest';

import { buildBlobDownloadUrl, uploadMailBlob, uploadMailBlobWithProgress } from './blob-client';

class FakeUploadRequest {
  method = '';
  url = '';
  withCredentials = false;
  status = 0;
  responseText = '';
  body: Document | XMLHttpRequestBodyInit | null = null;
  headers = new Map<string, string>();
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: ((event: ProgressEvent) => void) | null = null;
  onerror: ((event: ProgressEvent) => void) | null = null;
  onabort: ((event: ProgressEvent) => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body;
  }

  abort() {
    this.onabort?.({} as ProgressEvent);
  }
}

describe('mail blob client', () => {
  it('uploads raw bytes to the account-scoped blob endpoint', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            accountId: 'account-1',
            blobId: 'blob-1',
            type: 'text/plain',
            size: '5',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    await expect(
      uploadMailBlob({
        accountId: 'account-1',
        file,
        backendBaseUrl: 'https://api.example.test/',
        fetcher,
      }),
    ).resolves.toMatchObject({ blobId: 'blob-1', size: '5' });

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/mail/accounts/account-1/blobs',
      expect.objectContaining({
        method: 'POST',
        body: file,
        credentials: 'include',
        headers: { 'content-type': 'text/plain' },
      }),
    );
  });

  it('reports request progress and completes only after the server confirms the upload', async () => {
    const request = new FakeUploadRequest();
    const progress: number[] = [];
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    const result = uploadMailBlobWithProgress({
      accountId: 'account-1',
      file,
      backendBaseUrl: 'https://api.example.test/',
      onProgress: ({ percent }) => progress.push(percent),
      xhrFactory: () => request as unknown as XMLHttpRequest,
    });

    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.example.test/api/mail/accounts/account-1/blobs');
    expect(request.withCredentials).toBe(true);
    expect(request.headers.get('content-type')).toBe('text/plain');
    expect(request.body).toBe(file);

    request.upload.onprogress?.({
      lengthComputable: true,
      loaded: 5,
      total: 10,
    } as ProgressEvent);
    expect(progress).toEqual([50]);

    request.status = 200;
    request.responseText = JSON.stringify({
      accountId: 'account-1',
      blobId: 'blob-1',
      type: 'text/plain',
      size: '5',
    });
    request.onload?.({} as ProgressEvent);

    await expect(result).resolves.toMatchObject({ blobId: 'blob-1' });
    expect(progress).toEqual([50, 100]);
  });

  it('surfaces the server error code and supports aborting an upload', async () => {
    const failedRequest = new FakeUploadRequest();
    const failed = uploadMailBlobWithProgress({
      accountId: 'account-1',
      file: new File(['hello'], 'hello.txt'),
      backendBaseUrl: 'https://api.example.test',
      xhrFactory: () => failedRequest as unknown as XMLHttpRequest,
    });

    failedRequest.status = 503;
    failedRequest.responseText = JSON.stringify({ code: 'S3_UNAVAILABLE' });
    failedRequest.onload?.({} as ProgressEvent);
    await expect(failed).rejects.toThrow('S3_UNAVAILABLE');

    const abortedRequest = new FakeUploadRequest();
    const controller = new AbortController();
    const aborted = uploadMailBlobWithProgress({
      accountId: 'account-1',
      file: new File(['hello'], 'hello.txt'),
      backendBaseUrl: 'https://api.example.test',
      signal: controller.signal,
      xhrFactory: () => abortedRequest as unknown as XMLHttpRequest,
    });

    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('encodes account, blob and filename in download URLs', () => {
    expect(
      buildBlobDownloadUrl({
        accountId: 'account/1',
        blobId: 'blob 1',
        filename: 'report final.pdf',
        backendBaseUrl: 'https://api.example.test/',
      }),
    ).toBe(
      'https://api.example.test/api/mail/accounts/account%2F1/blobs/blob%201/report%20final.pdf',
    );
  });
});
