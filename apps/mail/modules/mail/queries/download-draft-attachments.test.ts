import { describe, expect, it, vi } from 'vitest';

import { downloadDraftAttachments } from './download-draft-attachments';

describe('downloadDraftAttachments', () => {
  it('downloads persisted draft attachments and preserves their blob ids', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('attachment bytes', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    );

    const result = await downloadDraftAttachments({
      accountId: 'account/1',
      attachments: [
        {
          blobId: 'blob/1',
          filename: 'report 1.pdf',
          contentType: 'application/pdf',
          size: '16',
        },
      ],
      backendBaseUrl: 'https://mail.example.test/',
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://mail.example.test/api/mail/accounts/account%2F1/blobs/blob%2F1/report%201.pdf',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.blobId).toBe('blob/1');
    expect(result[0]?.file).toMatchObject({
      name: 'report 1.pdf',
      type: 'application/pdf',
      size: 16,
    });
  });

  it('fails the attachment preparation when a persisted blob cannot be downloaded', async () => {
    await expect(
      downloadDraftAttachments({
        accountId: 'account-1',
        attachments: [
          {
            blobId: 'blob-1',
            filename: 'missing.pdf',
            contentType: 'application/pdf',
            size: '10',
          },
        ],
        backendBaseUrl: 'https://mail.example.test',
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })),
      }),
    ).rejects.toThrow('MAIL_BLOB_DOWNLOAD_FAILED:404');
  });

  it('rejects invalid cached descriptors without issuing a malformed request', async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      downloadDraftAttachments({
        accountId: 'account-1',
        attachments: [{ blobId: undefined, filename: undefined }] as never,
        backendBaseUrl: 'https://mail.example.test',
        fetcher,
      }),
    ).rejects.toThrow('INVALID_DRAFT_ATTACHMENT_DESCRIPTOR');

    expect(fetcher).not.toHaveBeenCalled();
  });
});
