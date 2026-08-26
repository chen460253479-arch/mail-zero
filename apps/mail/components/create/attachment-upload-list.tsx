import { CheckCircle2, FileIcon, LoaderCircle, RotateCw, Trash2 } from 'lucide-react';

import type { DraftAttachmentDescriptor } from '@/modules/mail/queries/download-draft-attachments';
import { cn, formatFileSize } from '@/lib/utils';
import { m } from '@/paraglide/messages';

import type { AttachmentUploadItem } from './attachment-upload-state';

export function DraftAttachmentLoadingList({
  attachments,
  error,
  onRetry,
}: {
  attachments: DraftAttachmentDescriptor[];
  error?: unknown;
  onRetry?: () => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-2" aria-live="polite">
      {attachments.map((attachment, index) => (
        <div
          key={`${attachment.blobId}:${attachment.filename}:${index}`}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl border px-3 py-2 transition-colors',
            error
              ? 'border-red-500 bg-red-50/60 dark:bg-red-950/20'
              : 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/20',
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
            <FileIcon className="h-5 w-5" aria-hidden="true" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={attachment.filename}>
              {attachment.filename}
            </p>
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <span>{formatFileSize(Number(attachment.size) || 0)}</span>
              <span aria-hidden="true">·</span>
              <span className={cn(Boolean(error) && 'text-red-700 dark:text-red-400')}>
                {error
                  ? m['pages.createEmail.attachmentDownloadFailed']()
                  : m['pages.createEmail.attachmentDownloading']()}
              </span>
            </div>
          </div>

          {error ? (
            onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 dark:hover:bg-white/10"
                aria-label={m['pages.createEmail.retryAttachmentDownload']()}
              >
                <RotateCw className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null
          ) : (
            <LoaderCircle
              className="text-muted-foreground h-4 w-4 shrink-0 animate-spin"
              aria-hidden="true"
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function AttachmentUploadList({
  items,
  onRemove,
  onRetry,
}: {
  items: AttachmentUploadItem[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-2" aria-live="polite">
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl border px-3 py-2 transition-colors',
            item.status === 'uploading' && 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/20',
            item.status === 'uploaded' &&
              'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20',
            item.status === 'failed' && 'border-red-500 bg-red-50/60 dark:bg-red-950/20',
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
            <FileIcon className="h-5 w-5" aria-hidden="true" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium" title={item.file.name}>
                {item.file.name}
              </p>
              {item.status === 'uploaded' && (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              )}
            </div>
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <span>{formatFileSize(item.file.size)}</span>
              <span aria-hidden="true">·</span>
              <span
                className={cn(
                  item.status === 'uploaded' && 'text-emerald-700 dark:text-emerald-400',
                  item.status === 'failed' && 'text-red-700 dark:text-red-400',
                )}
              >
                {item.status === 'uploading'
                  ? m['pages.createEmail.attachmentUploading']({ progress: item.progress })
                  : item.status === 'uploaded'
                    ? m['pages.createEmail.attachmentUploaded']()
                    : m['pages.createEmail.attachmentUploadFailed']()}
              </span>
            </div>

            {item.status === 'uploading' && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950">
                <div
                  className="h-full rounded-full bg-blue-500 transition-[width]"
                  style={{ width: `${item.progress}%` }}
                />
              </div>
            )}

            {item.status === 'failed' && (
              <button
                type="button"
                onClick={() => onRetry(item.id)}
                className="mt-1 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-red-700 hover:underline dark:text-red-400"
              >
                <RotateCw className="h-3 w-3" aria-hidden="true" />
                {m['pages.createEmail.retryAttachmentUpload']()}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 dark:hover:bg-white/10"
            aria-label={m['pages.createEmail.removeAttachment']({ name: item.file.name })}
          >
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
