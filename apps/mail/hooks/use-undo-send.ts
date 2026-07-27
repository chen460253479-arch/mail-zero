import { toast } from 'sonner';

import type { UserSettings } from '@zero/server/schemas';
import { isSendResult } from '@/lib/email-utils';
import { useMailDelivery } from '@/modules/mail';

export type EmailData = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  message: string;
  attachments: File[];
  fromEmail?: string;
  scheduleAt?: string;
};

export const useUndoSend = () => {
  const { cancelSubmission } = useMailDelivery();

  const handleUndoSend = (
    result: unknown,
    settings: { settings: UserSettings } | undefined,
    emailData?: EmailData,
  ) => {
    if (isSendResult(result) && settings?.settings?.undoSendEnabled) {
      const { messageId, sendAt } = result;
      const draftId =
        typeof result === 'object' &&
        result !== null &&
        'draftId' in result &&
        typeof result.draftId === 'string'
          ? result.draftId
          : null;

      const timeRemaining = sendAt ? Math.max(0, sendAt - Date.now()) : 15_000;
      const wasUserScheduled = Boolean(emailData?.scheduleAt);

      if (timeRemaining > 5_000) {
        if (wasUserScheduled) {
          toast.success('Email scheduled', {
            action: {
              label: 'Undo',
              onClick: async () => {
                try {
                  await cancelSubmission(messageId);
                  toast.info('Schedule cancelled');
                } catch {
                  toast.error('Failed to cancel');
                }
              },
            },
            duration: 15_000,
            closeButton: true,
          });
        } else {
          toast.success('Email sent', {
            action: {
              label: 'Undo',
              onClick: async () => {
                try {
                  await cancelSubmission(messageId);

                  const url = new URL(window.location.href);
                  url.searchParams.delete('activeReplyId');
                  url.searchParams.delete('mode');
                  if (draftId) url.searchParams.set('draftId', draftId);
                  url.searchParams.set('isComposeOpen', 'true');
                  window.history.replaceState({}, '', url.toString());

                  toast.info('Send cancelled');
                } catch {
                  toast.error('Failed to cancel');
                }
              },
            },
            duration: 15_000,
            closeButton: true,
          });
        }
      }
    }
  };

  return { handleUndoSend };
};
