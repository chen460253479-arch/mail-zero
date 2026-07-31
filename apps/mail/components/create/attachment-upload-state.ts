export type AttachmentUploadStatus = 'uploading' | 'uploaded' | 'failed';

export type AttachmentUploadItem = {
  id: string;
  file: File;
  status: AttachmentUploadStatus;
  progress: number;
  blobId: string | null;
  error: string | null;
};

export type AttachmentUploadAction =
  | { type: 'add'; items: AttachmentUploadItem[] }
  | { type: 'progress'; id: string; progress: number }
  | { type: 'uploaded'; id: string; blobId: string }
  | { type: 'failed'; id: string; error: string }
  | { type: 'retry'; id: string }
  | { type: 'remove'; id: string };

export function createAttachmentUploadItem(
  file: File,
  id: string,
  uploadedBlobId?: string,
): AttachmentUploadItem {
  return uploadedBlobId
    ? {
        id,
        file,
        status: 'uploaded',
        progress: 100,
        blobId: uploadedBlobId,
        error: null,
      }
    : {
        id,
        file,
        status: 'uploading',
        progress: 0,
        blobId: null,
        error: null,
      };
}

export function attachmentUploadReducer(
  state: AttachmentUploadItem[],
  action: AttachmentUploadAction,
): AttachmentUploadItem[] {
  if (action.type === 'add') return [...state, ...action.items];
  if (action.type === 'remove') return state.filter((item) => item.id !== action.id);

  return state.map((item) => {
    if (item.id !== action.id) return item;
    if (action.type === 'progress' && item.status === 'uploading') {
      return { ...item, progress: Math.min(95, Math.max(0, action.progress)) };
    }
    if (action.type === 'uploaded') {
      return {
        ...item,
        status: 'uploaded',
        progress: 100,
        blobId: action.blobId,
        error: null,
      };
    }
    if (action.type === 'failed') {
      return {
        ...item,
        status: 'failed',
        progress: 0,
        blobId: null,
        error: action.error,
      };
    }
    if (action.type === 'retry') {
      return {
        ...item,
        status: 'uploading',
        progress: 0,
        blobId: null,
        error: null,
      };
    }
    return item;
  });
}

export function attachmentUploadsBlockSend(items: AttachmentUploadItem[]) {
  return items.some((item) => item.status !== 'uploaded');
}
