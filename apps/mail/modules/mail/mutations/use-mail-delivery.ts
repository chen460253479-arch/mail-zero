import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { trpcClient, useTRPC } from '@/providers/query-provider';

import { buildDraftCreateInput, buildDraftUpdateInput, htmlToPlainText } from './draft-input';
import { buildCancelSubmissionInput, buildSubmissionCreateInput } from './submission-input';
import { useMailAccountContext } from '../providers/mail-account-provider';
import { selectDeliveryIdentity, toMailAddresses } from './delivery-input';
import { useMailIdentities } from '../queries/use-mail-identities';
import { uploadMailBlob } from '../api/blob-client';

const attachmentBlobIdCache = new WeakMap<File, string>();

const nextId = (prefix: string) =>
  globalThis.crypto?.randomUUID?.() ??
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export type SaveLocalDraftInput = {
  draftId?: string | null;
  replyToEmailId?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  htmlBody: string;
  attachments?: File[];
  fromEmail?: string;
};

export type SendLocalMessageInput = SaveLocalDraftInput & {
  scheduleAt?: string;
  undoWindowMs: number;
};

export function rememberMailAttachmentBlob(file: File, blobId: string) {
  attachmentBlobIdCache.set(file, blobId);
}

export function getRememberedMailAttachmentBlob(file: File) {
  return attachmentBlobIdCache.get(file);
}

export function useMailDelivery() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { account } = useMailAccountContext();
  const { identities } = useMailIdentities();
  const setEmail = useMutation(trpc.mail.email.set.mutationOptions());
  const setSubmission = useMutation(trpc.mail.submission.set.mutationOptions());

  const uploadAttachments = useCallback(
    async (files: File[]) => {
      if (!account) throw new Error('MAIL_ACCOUNT_UNAVAILABLE');
      return Promise.all(
        files.map(async (file) => {
          const existing = attachmentBlobIdCache.get(file);
          if (existing) return { blobId: existing, filename: file.name };
          const uploaded = await uploadMailBlob({
            accountId: account.id,
            file,
            backendBaseUrl: import.meta.env.VITE_PUBLIC_BACKEND_URL,
          });
          attachmentBlobIdCache.set(file, uploaded.blobId);
          return { blobId: uploaded.blobId, filename: file.name };
        }),
      );
    },
    [account],
  );

  const saveDraft = useCallback(
    async (input: SaveLocalDraftInput) => {
      if (!account) throw new Error('MAIL_ACCOUNT_UNAVAILABLE');
      const identity = selectDeliveryIdentity(identities, input.fromEmail);
      if (!identity) throw new Error('MAIL_IDENTITY_UNAVAILABLE');

      const attachmentIds = await uploadAttachments(input.attachments ?? []);
      const content = {
        identityId: identity.id,
        replyToEmailId: input.replyToEmailId ?? null,
        to: toMailAddresses(input.to),
        cc: toMailAddresses(input.cc ?? []),
        bcc: toMailAddresses(input.bcc ?? []),
        subject: input.subject,
        textBody: htmlToPlainText(input.htmlBody),
        htmlBody: input.htmlBody,
        attachments: attachmentIds,
      };

      if (input.draftId) {
        const current = await trpcClient.mail.email.get.query({
          accountId: account.id,
          ids: [input.draftId],
        });
        const draft = current.list[0];
        if (!draft || draft.lifecycle !== 'draft') {
          throw new Error('DRAFT_NOT_FOUND');
        }
        if (draft.draftRevision === undefined) {
          throw new Error('DRAFT_REVISION_UNAVAILABLE');
        }
        const result = await setEmail.mutateAsync(
          buildDraftUpdateInput({
            accountId: account.id,
            state: current.state,
            draftId: input.draftId,
            draftRevision: draft.draftRevision,
            content,
          }),
        );
        const failure = result.notUpdated[input.draftId];
        const updated = result.updated[input.draftId];
        if (failure || !updated) throw new Error(failure?.code ?? 'DRAFT_UPDATE_FAILED');
        return {
          id: updated.id,
          draftRevision: updated.draftRevision,
          identityId: identity.id,
        };
      }

      const clientId = nextId('draft');
      const result = await setEmail.mutateAsync(
        buildDraftCreateInput({
          accountId: account.id,
          clientId,
          content,
        }),
      );
      const failure = result.notCreated[clientId];
      const created = result.created[clientId];
      if (failure || !created) throw new Error(failure?.code ?? 'DRAFT_CREATE_FAILED');
      return {
        id: created.id,
        draftRevision: created.draftRevision,
        identityId: identity.id,
      };
    },
    [account, identities, setEmail, uploadAttachments],
  );

  const sendMessage = useCallback(
    async (input: SendLocalMessageInput) => {
      if (!account) throw new Error('MAIL_ACCOUNT_UNAVAILABLE');
      const draft = await saveDraft(input);
      const clientId = nextId('submission');
      const result = await setSubmission.mutateAsync(
        buildSubmissionCreateInput({
          accountId: account.id,
          clientId,
          emailId: draft.id,
          identityId: draft.identityId,
          idempotencyKey: nextId('send'),
          scheduleAt: input.scheduleAt,
          undoWindowMs: input.undoWindowMs,
        }),
      );
      const failure = result.notCreated[clientId];
      const submission = result.created[clientId];
      if (failure || !submission) {
        throw new Error(failure?.code ?? 'SUBMISSION_CREATE_FAILED');
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: trpc.mail.view.threadPage.infiniteQueryKey(),
        }),
        queryClient.invalidateQueries({ queryKey: trpc.mail.email.get.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.mail.submission.query.queryKey() }),
      ]);

      return {
        ...(input.scheduleAt ? { scheduled: true as const } : { queued: true as const }),
        messageId: submission.id,
        draftId: draft.id,
        sendAt: Date.parse(submission.sendAt),
      };
    },
    [
      account,
      queryClient,
      saveDraft,
      setSubmission,
      trpc.mail.email.get,
      trpc.mail.submission.query,
      trpc.mail.view.threadPage,
    ],
  );

  const cancelSubmission = useCallback(
    async (submissionId: string) => {
      if (!account) throw new Error('MAIL_ACCOUNT_UNAVAILABLE');
      const current = await trpcClient.mail.submission.get.query({
        accountId: account.id,
        ids: [submissionId],
      });
      const result = await setSubmission.mutateAsync(
        buildCancelSubmissionInput({
          accountId: account.id,
          state: current.state,
          submissionId,
        }),
      );
      const failure = result.notDestroyed[submissionId];
      if (failure) throw new Error(failure.code);
      return result.destroyed.includes(submissionId);
    },
    [account, setSubmission],
  );

  return {
    saveDraft,
    sendMessage,
    cancelSubmission,
    isSavingDraft: setEmail.isPending,
    isSubmitting: setSubmission.isPending,
  };
}
