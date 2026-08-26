import type {
  DraftAttachmentDescriptor,
  DraftAttachmentReference,
} from '@/modules/mail/model/draft';

export type AttachmentUploadStatus = 'uploading' | 'uploaded' | 'failed';

export type AttachmentUploadItem = {
  id: string;
  file: File | null;
  filename: string;
  contentType: string;
  size: number;
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

export function createAttachmentUploadItem(file: File, id: string): AttachmentUploadItem {
  return {
    id,
    file,
    filename: file.name,
    contentType: file.type,
    size: file.size,
    status: 'uploading',
    progress: 0,
    blobId: null,
    error: null,
  };
}

export function createPersistedAttachmentItem(
  attachment: DraftAttachmentDescriptor,
  id: string,
): AttachmentUploadItem {
  return {
    id,
    file: null,
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: Number(attachment.size) || 0,
    status: 'uploaded',
    progress: 100,
    blobId: attachment.blobId,
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

export function attachmentReferences(items: AttachmentUploadItem[]): DraftAttachmentReference[] {
  return items.flatMap((item) =>
    item.status === 'uploaded' && item.blobId
      ? [{ blobId: item.blobId, filename: item.filename }]
      : [],
  );
}
