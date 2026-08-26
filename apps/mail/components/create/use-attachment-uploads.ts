import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { useMailAccountContext } from '@/modules/mail/providers/mail-account-provider';
import { uploadMailBlobWithProgress } from '@/modules/mail/api/blob-client';
import type { DraftAttachmentDescriptor } from '@/modules/mail/model/draft';

import {
  attachmentUploadReducer,
  attachmentReferences,
  createAttachmentUploadItem,
  createPersistedAttachmentItem,
  type AttachmentUploadItem,
} from './attachment-upload-state';

const nextAttachmentId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `attachment_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export function useAttachmentUploads({
  initialAttachments,
  onAttachmentsChanged,
}: {
  initialAttachments: DraftAttachmentDescriptor[];
  onAttachmentsChanged: () => void;
}) {
  const { account } = useMailAccountContext();
  const [items, dispatch] = useReducer(
    attachmentUploadReducer,
    initialAttachments,
    (files): AttachmentUploadItem[] =>
      files.map((attachment) => createPersistedAttachmentItem(attachment, nextAttachmentId())),
  );
  const controllers = useRef(new Map<string, AbortController>());

  const startUpload = useCallback(
    async (item: AttachmentUploadItem) => {
      const controller = new AbortController();
      controllers.current.set(item.id, controller);

      if (!account) {
        dispatch({ type: 'failed', id: item.id, error: 'MAIL_ACCOUNT_UNAVAILABLE' });
        controllers.current.delete(item.id);
        return;
      }
      if (!item.file) {
        dispatch({ type: 'failed', id: item.id, error: 'MAIL_ATTACHMENT_FILE_UNAVAILABLE' });
        controllers.current.delete(item.id);
        return;
      }

      try {
        const uploaded = await uploadMailBlobWithProgress({
          accountId: account.id,
          file: item.file,
          backendBaseUrl: import.meta.env.VITE_PUBLIC_BACKEND_URL,
          signal: controller.signal,
          onProgress: ({ percent }) => {
            dispatch({ type: 'progress', id: item.id, progress: percent });
          },
        });
        dispatch({ type: 'uploaded', id: item.id, blobId: uploaded.blobId });
        onAttachmentsChanged();
      } catch (error) {
        if (!controller.signal.aborted) {
          dispatch({
            type: 'failed',
            id: item.id,
            error: error instanceof Error ? error.message : 'MAIL_BLOB_UPLOAD_FAILED',
          });
        }
      } finally {
        controllers.current.delete(item.id);
      }
    },
    [account, onAttachmentsChanged],
  );

  useEffect(() => {
    for (const item of items) {
      if (item.status === 'uploading' && !controllers.current.has(item.id)) {
        void startUpload(item);
      }
    }
  }, [items, startUpload]);

  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
      controllers.current.clear();
    },
    [],
  );

  const addAttachments = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const added = files.map((file) => createAttachmentUploadItem(file, nextAttachmentId()));
      dispatch({ type: 'add', items: added });
      onAttachmentsChanged();
      for (const item of added) void startUpload(item);
    },
    [onAttachmentsChanged, startUpload],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      controllers.current.get(id)?.abort();
      controllers.current.delete(id);
      dispatch({ type: 'remove', id });
      onAttachmentsChanged();
    },
    [onAttachmentsChanged],
  );

  const retryAttachment = useCallback(
    (id: string) => {
      const item = items.find((candidate) => candidate.id === id);
      if (!item || item.status !== 'failed') return;
      dispatch({ type: 'retry', id });
      void startUpload(item);
    },
    [items, startUpload],
  );

  const attachments = useMemo(() => attachmentReferences(items), [items]);

  return {
    items,
    attachments,
    addAttachments,
    removeAttachment,
    retryAttachment,
  };
}
