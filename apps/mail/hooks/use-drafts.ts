import type { DraftAttachmentDescriptor } from '@/modules/mail/model/draft';
import { mailQueryKeys, useMailAccountContext } from '@/modules/mail';
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
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
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
