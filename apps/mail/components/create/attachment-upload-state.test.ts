import { describe, expect, it } from 'vitest';

import {
  attachmentUploadReducer,
  attachmentReferences,
  attachmentUploadsBlockSend,
  createAttachmentUploadItem,
  createPersistedAttachmentItem,
} from './attachment-upload-state';

describe('attachment upload state', () => {
  it('tracks progress and marks an attachment uploaded only after confirmation', () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    const uploading = createAttachmentUploadItem(file, 'attachment-1');

    expect(uploading).toMatchObject({
      id: 'attachment-1',
      file,
      filename: 'hello.txt',
      progress: 0,
      status: 'uploading',
      blobId: null,
    });
    expect(attachmentUploadsBlockSend([uploading])).toBe(true);

    const progressed = attachmentUploadReducer([uploading], {
      type: 'progress',
      id: uploading.id,
      progress: 72,
    });
    expect(progressed[0]).toMatchObject({ progress: 72, status: 'uploading' });

    const uploaded = attachmentUploadReducer(progressed, {
      type: 'uploaded',
      id: uploading.id,
      blobId: 'blob-1',
    });
    expect(uploaded[0]).toMatchObject({
      progress: 100,
      status: 'uploaded',
      blobId: 'blob-1',
      error: null,
    });
    expect(attachmentUploadsBlockSend(uploaded)).toBe(false);
  });

  it('represents persisted attachments from metadata without a File or download', () => {
    const persisted = createPersistedAttachmentItem(
      {
        blobId: 'blob-1',
        filename: 'report.pdf',
        contentType: 'application/pdf',
        size: '4096',
      },
      'persisted-1',
    );

    expect(persisted).toMatchObject({
      id: 'persisted-1',
      file: null,
      filename: 'report.pdf',
      contentType: 'application/pdf',
      size: 4096,
      status: 'uploaded',
      blobId: 'blob-1',
    });
    expect(attachmentUploadsBlockSend([persisted])).toBe(false);
    expect(attachmentReferences([persisted])).toEqual([
      { blobId: 'blob-1', filename: 'report.pdf' },
    ]);
  });

  it('blocks sending after failure until the attachment is retried or removed', () => {
    const item = createAttachmentUploadItem(new File(['hello'], 'hello.txt'), 'attachment-1');
    const failed = attachmentUploadReducer([item], {
      type: 'failed',
      id: item.id,
      error: 'S3_UNAVAILABLE',
    });

    expect(failed[0]).toMatchObject({
      status: 'failed',
      progress: 0,
      blobId: null,
      error: 'S3_UNAVAILABLE',
    });
    expect(attachmentUploadsBlockSend(failed)).toBe(true);

    const retried = attachmentUploadReducer(failed, { type: 'retry', id: item.id });
    expect(retried[0]).toMatchObject({
      status: 'uploading',
      progress: 0,
      blobId: null,
      error: null,
    });

    const removed = attachmentUploadReducer(retried, { type: 'remove', id: item.id });
    expect(removed).toEqual([]);
    expect(attachmentUploadsBlockSend(removed)).toBe(false);
  });
});
