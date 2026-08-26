import { constructReplyBody, constructForwardBody, formatDate } from '@/lib/utils';
import { useActiveConnection } from '@/hooks/use-connections';
import { useEmailAliases } from '@/hooks/use-email-aliases';
import { EmailComposer } from '../create/email-composer';
import { useHotkeysContext } from 'react-hotkeys-hook';
import { useUndoSend } from '@/hooks/use-undo-send';
import { useSettings } from '@/hooks/use-settings';
import { useMailDelivery } from '@/modules/mail';
import { useThread } from '@/hooks/use-threads';
import { useSession } from '@/lib/auth-client';
import { useDraft } from '@/hooks/use-drafts';
import { m } from '@/paraglide/messages';
import type { Sender } from '@/types';
import { useQueryState } from 'nuqs';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { getReplyComposerDefaults, type ReplyMode } from './reply-composer-defaults';
import type { DraftAttachmentReference } from '@/modules/mail/model/draft';

interface ReplyComposeProps {
  messageId?: string;
}

export default function ReplyCompose({ messageId }: ReplyComposeProps) {
  const [mode, setMode] = useQueryState('mode');
  const { enableScope, disableScope } = useHotkeysContext();
  const { data: aliases, isLoading: aliasesLoading } = useEmailAliases();

  const [draftId, setDraftId] = useQueryState('draftId');
  const [threadId] = useQueryState('threadId');
  const [, setActiveReplyId] = useQueryState('activeReplyId');
  const { data: emailData, refetch, latestDraft } = useThread(threadId);
  const { data: draft, isLoading: draftLoading } = useDraft(draftId ?? null);
  const { sendMessage } = useMailDelivery();
  const { data: activeConnection } = useActiveConnection();
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const { data: session } = useSession();
  const { handleUndoSend } = useUndoSend();

  // Find the specific message to reply to
  const replyToMessage =
    (messageId && emailData?.messages.find((msg) => msg.id === messageId)) || emailData?.latest;

  const handleSendEmail = async (data: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    message: string;
    attachments: DraftAttachmentReference[];
    fromEmail?: string;
    scheduleAt?: string;
    draftId?: string;
  }) => {
    if (!replyToMessage || !activeConnection?.email) return;

    try {
      const userEmail = activeConnection.email.toLowerCase();
      const userName = activeConnection.name || session?.user?.name || '';

      let fromEmail = userEmail;

      if (aliases && aliases.length > 0 && replyToMessage) {
        const allRecipients = [
          ...(replyToMessage.to || []),
          ...(replyToMessage.cc || []),
          ...(replyToMessage.bcc || []),
        ];
        const matchingAlias = aliases.find((alias) =>
          allRecipients.some(
            (recipient) => recipient.email.toLowerCase() === alias.email.toLowerCase(),
          ),
        );

        if (matchingAlias) {
          fromEmail = userName.trim()
            ? `${userName.replace(/[<>]/g, '')} <${matchingAlias.email}>`
            : matchingAlias.email;
        } else {
          const primaryEmail =
            aliases.find((alias) => alias.primary)?.email || aliases[0]?.email || userEmail;
          fromEmail = userName.trim()
            ? `${userName.replace(/[<>]/g, '')} <${primaryEmail}>`
            : primaryEmail;
        }
      }

      const toRecipients: Sender[] = data.to.map((email) => ({
        email,
        name: email.split('@')[0] || 'User',
      }));

      const ccRecipients: Sender[] | undefined = data.cc
        ? data.cc.map((email) => ({
            email,
            name: email.split('@')[0] || 'User',
          }))
        : undefined;

      const bccRecipients: Sender[] | undefined = data.bcc
        ? data.bcc.map((email) => ({
            email,
            name: email.split('@')[0] || 'User',
          }))
        : undefined;

      const zeroSignature = settings?.settings.zeroSignature
        ? '<p style="color: #666; font-size: 12px;">Sent via <a href="https://0.email/" style="color: #0066cc; text-decoration: none;">Zero</a></p>'
        : '';

      const emailBody =
        mode === 'forward'
          ? constructForwardBody(
              data.message + zeroSignature,
              formatDate(new Date(replyToMessage.receivedOn || '')),
              { ...replyToMessage.sender, subject: replyToMessage.subject },
              toRecipients,
              //   replyToMessage.decodedBody,
            )
          : constructReplyBody(
              data.message + zeroSignature,
              formatDate(new Date(replyToMessage.receivedOn || '')),
              replyToMessage.sender,
              toRecipients,
              //   replyToMessage.decodedBody,
            );

      const result = await sendMessage({
        to: toRecipients.map((recipient) => recipient.email),
        cc: ccRecipients?.map((recipient) => recipient.email),
        bcc: bccRecipients?.map((recipient) => recipient.email),
        subject: data.subject,
        htmlBody: emailBody,
        attachments: data.attachments,
        fromEmail: fromEmail,
        draftId: data.draftId ?? draftId ?? undefined,
        replyToEmailId: mode === 'forward' ? null : replyToMessage.id,
        scheduleAt: data.scheduleAt,
        undoWindowMs: settings?.settings.undoSendEnabled ? 30_000 : 0,
      });

      // Reset states
      setMode(null);
      await refetch();

      handleUndoSend(result, settings, {
        to: data.to,
        cc: data.cc,
        bcc: data.bcc,
        subject: data.subject,
        message: data.message,
        attachments: data.attachments,
        scheduleAt: data.scheduleAt,
      });
    } catch (error) {
      console.error('Error sending email:', error);
      toast.error(m['pages.createEmail.failedToSendEmail']());
    }
  };

  useEffect(() => {
    if (mode) {
      enableScope('compose');
    } else {
      disableScope('compose');
    }
    return () => {
      disableScope('compose');
    };
  }, [mode, enableScope, disableScope]);

  const ensureEmailArray = (emails: string | string[] | undefined | null): string[] => {
    if (!emails) return [];
    if (Array.isArray(emails)) {
      return emails.map((email) => email.trim().replace(/[<>]/g, ''));
    }
    if (typeof emails === 'string') {
      return emails
        .split(',')
        .map((email) => email.trim())
        .filter((email) => email.length > 0)
        .map((email) => email.replace(/[<>]/g, ''));
    }
    return [];
  };

  if (
    !mode ||
    !emailData ||
    !replyToMessage ||
    !activeConnection?.email ||
    aliasesLoading ||
    (draftId && draftLoading)
  ) {
    return null;
  }

  const composerDefaults = getReplyComposerDefaults({
    message: replyToMessage,
    mode: mode as ReplyMode,
    accountEmail: activeConnection.email,
    aliases: aliases?.map((alias) => alias.email),
  });
  const latestDraftTo = latestDraft?.to.map((recipient) => recipient.email) ?? [];
  const latestDraftCc = latestDraft?.cc?.map((recipient) => recipient.email) ?? [];
  const latestDraftBcc = latestDraft?.bcc?.map((recipient) => recipient.email) ?? [];
  const hasLatestDraft = Boolean(latestDraft);

  return (
    <div className="w-full overflow-visible rounded-2xl border">
      <EmailComposer
        key={`${replyToMessage.id}:${mode}:${draft?.id ?? latestDraft?.id ?? 'new'}`}
        editorClassName="min-h-[50px]"
        className="max-w-none! w-full overflow-visible pb-1"
        onSendEmail={handleSendEmail}
        onClose={async () => {
          setMode(null);
          setDraftId(null);
          setActiveReplyId(null);
        }}
        initialMessage={draft?.content ?? latestDraft?.decodedBody}
        initialTo={
          draft ? ensureEmailArray(draft.to) : hasLatestDraft ? latestDraftTo : composerDefaults.to
        }
        initialCc={
          draft ? ensureEmailArray(draft.cc) : hasLatestDraft ? latestDraftCc : composerDefaults.cc
        }
        initialBcc={ensureEmailArray(draft?.bcc ?? latestDraftBcc)}
        initialSubject={draft?.subject ?? latestDraft?.subject ?? composerDefaults.subject}
        initialAttachments={draft?.attachments ?? []}
        autofocus={true}
        settingsLoading={settingsLoading}
        replyingTo={replyToMessage?.sender.email}
      />
    </div>
  );
}
