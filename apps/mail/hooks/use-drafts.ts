import {
  buildBlobDownloadUrl,
  mailQueryKeys,
  rememberMailAttachmentBlob,
  useMailAccountContext,
} from '@/modules/mail';
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
        fetchTextBodyValues: true,
        fetchHTMLBodyValues: true,
      });
      const draft = result.list[0];
      if (!draft || draft.lifecycle !== 'draft') throw new Error('DRAFT_NOT_FOUND');
      const attachments = await Promise.all(
        (draft.attachments ?? []).flatMap((part) => {
          if (!part.blobId) return [];
          return [
            fetch(
              buildBlobDownloadUrl({
                accountId: account.id,
                blobId: part.blobId,
                filename: part.filename ?? 'attachment',
                backendBaseUrl: import.meta.env.VITE_PUBLIC_BACKEND_URL,
              }),
              { credentials: 'include' },
            ).then(async (response) => {
              if (!response.ok) throw new Error(`MAIL_BLOB_DOWNLOAD_FAILED:${response.status}`);
              const file = new File([await response.blob()], part.filename ?? 'attachment', {
                type: part.contentType,
              });
              rememberMailAttachmentBlob(file, part.blobId!);
              return file;
            }),
          ];
        }),
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
