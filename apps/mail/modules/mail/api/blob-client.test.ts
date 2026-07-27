import { describe, expect, it, vi } from 'vitest';

import { buildBlobDownloadUrl, uploadMailBlob } from './blob-client';

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
