import { useActiveConnection } from '@/hooks/use-connections';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { useEmailAliases } from '@/hooks/use-email-aliases';
import { cleanEmailAddresses } from '@/lib/email-utils';
import { useUndoSend } from '@/hooks/use-undo-send';

import type {
  DraftAttachmentDescriptor,
  DraftAttachmentReference,
} from '@/modules/mail/model/draft';
import { useSettings } from '@/hooks/use-settings';
import { EmailComposer } from './email-composer';
import { useSession } from '@/lib/auth-client';
import { useDraft } from '@/hooks/use-drafts';
import { useEffect, useState } from 'react';

import { useMailDelivery } from '@/modules/mail';
import { m } from '@/paraglide/messages';
import { useQueryState } from 'nuqs';
import { X } from '../icons/icons';
import { toast } from 'sonner';
import './prosemirror.css';

// Define the draft type to include CC and BCC fields
type DraftType = {
  id: string;
  content?: string;
  subject?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  draftRevision: number;
  attachments: DraftAttachmentDescriptor[];
};

export function CreateEmail({
  initialTo = '',
  initialSubject = '',
  initialBody = '',
  initialCc = '',
  initialBcc = '',
  draftId: propDraftId,
}: {
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  initialCc?: string;
  initialBcc?: string;
  draftId?: string | null;
}) {
  const { data: session } = useSession();

  const { data: aliases } = useEmailAliases();
  const [draftId, setDraftId] = useQueryState('draftId');
  const {
    data: draft,
    isLoading: isDraftLoading,
    error: draftError,
  } = useDraft(draftId ?? propDraftId ?? null);

  const [, setIsDraftFailed] = useState(false);
  const { sendMessage } = useMailDelivery();
  const [isComposeOpen, setIsComposeOpen] = useQueryState('isComposeOpen');
  const [, setThreadId] = useQueryState('threadId');
  const [, setActiveReplyId] = useQueryState('activeReplyId');
  const { data: activeConnection } = useActiveConnection();
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const { handleUndoSend } = useUndoSend();
  // If there was an error loading the draft, set the failed state
  useEffect(() => {
    if (draftError) {
      console.error('Error loading draft:', draftError);
      setIsDraftFailed(true);
      toast.error(m['pages.createEmail.failedToLoadDraft']());
    }
  }, [draftError]);

  const { data: activeAccount } = useActiveConnection();

  const userEmail = activeAccount?.email || activeConnection?.email || session?.user?.email || '';
  const userName = activeAccount?.name || activeConnection?.name || session?.user?.name || '';

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
    const fromEmail = data.fromEmail || aliases?.[0]?.email || userEmail;

    const zeroSignature = settings?.settings.zeroSignature
      ? '<p style="color: #666; font-size: 12px;">Sent via <a href="https://0.email/" style="color: #0066cc; text-decoration: none;">Zero</a></p>'
      : '';

    const result = await sendMessage({
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      htmlBody: data.message + zeroSignature,
      attachments: data.attachments,
      fromEmail: userName.trim() ? `${userName.replace(/[<>]/g, '')} <${fromEmail}>` : fromEmail,
      draftId: data.draftId ?? draftId ?? undefined,
      scheduleAt: data.scheduleAt,
      undoWindowMs: settings?.settings.undoSendEnabled ? 30_000 : 0,
    });

    setDraftId(null);

    handleUndoSend(result, settings, {
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      message: data.message,
      attachments: data.attachments,
      fromEmail: data.fromEmail,
      scheduleAt: data.scheduleAt,
    });
  };

  useEffect(() => {
    if (propDraftId && !draftId) {
      setDraftId(propDraftId);
    }
  }, [propDraftId, draftId, setDraftId]);

  // Process initial email addresses
  const processInitialEmails = (emailStr: string) => {
    if (!emailStr) return [];
    const cleanedAddresses = cleanEmailAddresses(emailStr);
    return cleanedAddresses || [];
  };

  // Cast draft to our extended type that includes CC and BCC
  const typedDraft = draft as unknown as DraftType;

  const handleDialogClose = (open: boolean) => {
    setIsComposeOpen(open ? 'true' : null);
    if (!open) {
      setDraftId(null);
    }
  };

  return (
    <>
      <Dialog open={!!isComposeOpen} onOpenChange={handleDialogClose}>
        <div className="flex min-h-screen flex-col items-center justify-center gap-1">
          <div className="flex w-[750px] justify-start">
            <DialogClose asChild className="flex">
              <button className="dark:bg-panelDark flex cursor-pointer items-center gap-1 rounded-lg bg-[#F0F0F0] px-2 py-1 transition-colors hover:bg-gray-100 dark:hover:bg-[#404040]">
                <X className="fill-muted-foreground mt-0.5 h-3.5 w-3.5 dark:fill-[#929292]" />
                <span className="text-muted-foreground text-sm font-medium dark:text-white">
                  esc
                </span>
              </button>
            </DialogClose>
          </div>
          {isDraftLoading ? (
            <div className="flex h-[600px] w-[750px] items-center justify-center rounded-2xl border">
              <div className="text-center">
                <div className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"></div>
                <p>{m['pages.createEmail.loadingDraft']()}</p>
              </div>
            </div>
          ) : (
            <EmailComposer
              key={typedDraft?.id || 'composer'}
              className="mb-12 rounded-2xl border"
              onSendEmail={handleSendEmail}
              initialMessage={typedDraft?.content || initialBody}
              initialTo={
                typedDraft?.to?.map((e: string) => e.replace(/[<>]/g, '')) ||
                processInitialEmails(initialTo)
              }
              initialCc={
                typedDraft?.cc?.map((e: string) => e.replace(/[<>]/g, '')) ||
                processInitialEmails(initialCc)
              }
              initialBcc={
                typedDraft?.bcc?.map((e: string) => e.replace(/[<>]/g, '')) ||
                processInitialEmails(initialBcc)
              }
              onClose={() => {
                setThreadId(null);
                setActiveReplyId(null);
                setIsComposeOpen(null);
                setDraftId(null);
              }}
              initialAttachments={typedDraft?.attachments ?? []}
              initialSubject={typedDraft?.subject || initialSubject}
              autofocus={false}
              settingsLoading={settingsLoading}
            />
          )}
        </div>
      </Dialog>
    </>
  );
}
