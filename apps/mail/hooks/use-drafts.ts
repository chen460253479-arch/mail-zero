import {
  downloadDraftAttachments,
  type DraftAttachmentDescriptor,
} from '@/modules/mail/queries/download-draft-attachments';
import { mailQueryKeys, rememberMailAttachmentBlob, useMailAccountContext } from '@/modules/mail';
import { trpcClient } from '@/providers/query-provider';
import { useQuery } from '@tanstack/react-query';

const bodyValue = (
  parts: Array<{ id: string }>,
  values: Record<string, { value: string; isTruncated: boolean }>,
) => parts.map((part) => values[part.id]?.value ?? '').join('');

export const useDraft = (id: string | null) => {
  const { account, status } = useMailAccountContext();
  return useQuery({
    queryKey: mailQueryKeys.email(account?.id ?? '', id ?? ''),
    enabled: status === 'ready' && Boolean(account && id),
    staleTime: 60 * 60_000,
    queryFn: async () => {
      if (!account || !id) throw new Error('DRAFT_NOT_FOUND');
      const result = await trpcClient.mail.email.get.query({
        accountId: account.id,
        ids: [id],
        properties: [
          'lifecycle',
          'draftRevision',
          'receivedAt',
          'subject',
          'to',
          'cc',
          'bcc',
          'textBody',
          'htmlBody',
          'attachments',
          'bodyValues',
        ],
        fetchTextBodyValues: true,
        fetchHTMLBodyValues: true,
      });
      const draft = result.list[0];
      if (!draft || draft.lifecycle !== 'draft') throw new Error('DRAFT_NOT_FOUND');
      if (draft.draftRevision === undefined) throw new Error('DRAFT_REVISION_UNAVAILABLE');
      const attachments = (draft.attachments ?? []).flatMap((part): DraftAttachmentDescriptor[] =>
        part.blobId
          ? [
              {
                blobId: part.blobId,
                filename: part.filename ?? 'attachment',
                contentType: part.contentType,
                size: part.size,
              },
            ]
          : [],
      );

      return {
        id: draft.id,
        draftRevision: draft.draftRevision,
        receivedOn: draft.receivedAt,
        content:
          bodyValue(draft.htmlBody ?? [], draft.bodyValues ?? {}) ||
          bodyValue(draft.textBody ?? [], draft.bodyValues ?? {}),
        subject: draft.subject ?? '',
        to: (draft.to ?? []).map((address) => address.email),
        cc: (draft.cc ?? []).map((address) => address.email),
        bcc: (draft.bcc ?? []).map((address) => address.email),
        attachments,
      };
    },
  });
};

export const useDraftAttachments = (
  id: string | null,
  draftRevision: number | null,
  attachments: DraftAttachmentDescriptor[],
) => {
  const { account, status } = useMailAccountContext();
  const canDownload =
    status === 'ready' &&
    Boolean(account && id) &&
    draftRevision !== null &&
    attachments.length > 0;

  return useQuery({
    queryKey: mailQueryKeys.draftAttachments(account?.id ?? '', id ?? '', draftRevision ?? 0),
    enabled: canDownload,
    staleTime: 60 * 60_000,
    queryFn: async ({ signal }) => {
      if (!account || !id) throw new Error('DRAFT_NOT_FOUND');
      const downloaded = await downloadDraftAttachments({
        accountId: account.id,
        attachments,
        backendBaseUrl: import.meta.env.VITE_PUBLIC_BACKEND_URL,
        signal,
      });
      for (const { blobId, file } of downloaded) {
        rememberMailAttachmentBlob(file, blobId);
      }
      return downloaded.map(({ file }) => file);
    },
  });
};
