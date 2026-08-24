import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import {
  getRememberedMailAttachmentBlob,
  rememberMailAttachmentBlob,
} from '@/modules/mail/mutations/use-mail-delivery';
import { useMailAccountContext } from '@/modules/mail/providers/mail-account-provider';
import { uploadMailBlobWithProgress } from '@/modules/mail/api/blob-client';

import {
  attachmentUploadReducer,
  createAttachmentUploadItem,
  type AttachmentUploadItem,
} from './attachment-upload-state';

const nextAttachmentId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `attachment_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export function useAttachmentUploads({
  initialAttachments,
  onAttachmentsChanged,
}: {
  initialAttachments: File[];
  onAttachmentsChanged: () => void;
}) {
  const { account } = useMailAccountContext();
  const knownInitialAttachments = useRef(new WeakSet<File>());
  const [items, dispatch] = useReducer(
    attachmentUploadReducer,
    initialAttachments,
    (files): AttachmentUploadItem[] =>
      files.map((file) => {
        knownInitialAttachments.current.add(file);
        return createAttachmentUploadItem(
          file,
          nextAttachmentId(),
          getRememberedMailAttachmentBlob(file),
        );
      }),
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
        rememberMailAttachmentBlob(item.file, uploaded.blobId);
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
    const added = initialAttachments.flatMap((file) => {
      if (knownInitialAttachments.current.has(file)) return [];
      knownInitialAttachments.current.add(file);
      return [
        createAttachmentUploadItem(file, nextAttachmentId(), getRememberedMailAttachmentBlob(file)),
      ];
    });
    if (added.length > 0) dispatch({ type: 'add', items: added });
  }, [initialAttachments]);

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

  const uploadedFiles = useMemo(
    () => items.filter((item) => item.status === 'uploaded').map((item) => item.file),
    [items],
  );

  return {
    items,
    uploadedFiles,
    hasPendingInitialAttachments: initialAttachments.some(
      (file) => !knownInitialAttachments.current.has(file),
    ),
    addAttachments,
    removeAttachment,
    retryAttachment,
  };
}
