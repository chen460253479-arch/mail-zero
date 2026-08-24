import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Command, LoaderCircle, Paperclip, RotateCw, Type } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEmailAliases } from '@/hooks/use-email-aliases';
import { ScheduleSendPicker } from './schedule-send-picker';
import useComposeEditor from '@/hooks/use-compose-editor';
import { gitHubEmojis } from '@tiptap/extension-emoji';
import { zodResolver } from '@hookform/resolvers/zod';
import { CurvedArrow, X } from '../icons/icons';

import { useSettings } from '@/hooks/use-settings';

import { useForm, type Resolver } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { EditorContent } from '@tiptap/react';
import { Button } from '../ui/button';
import { useQueryState } from 'nuqs';
import { Toolbar } from './toolbar';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { z } from 'zod';

import { RecipientAutosuggest } from '@/components/ui/recipient-autosuggest';
import { attachmentUploadsBlockSend } from './attachment-upload-state';
import { useAttachmentUploads } from './use-attachment-uploads';
import { AttachmentUploadList } from './attachment-upload-list';
import { useMailDelivery } from '@/modules/mail';
import { m } from '@/paraglide/messages';

const shortcodeRegex = /:([a-zA-Z0-9_+-]+):/g;
import { TemplateButton } from './template-button';

interface EmailComposerProps {
  initialTo?: string[];
  initialCc?: string[];
  initialBcc?: string[];
  initialSubject?: string;
  initialMessage?: string;
  initialAttachments?: File[];
  initialAttachmentsLoading?: boolean;
  initialAttachmentsError?: unknown;
  onRetryInitialAttachments?: () => void;
  replyingTo?: string;
  onSendEmail: (data: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    message: string;
    attachments: File[];
    fromEmail?: string;
    scheduleAt?: string;
    draftId?: string;
  }) => Promise<void>;
  onClose?: () => void;
  className?: string;
  autofocus?: boolean;
  settingsLoading?: boolean;
  editorClassName?: string;
}

const schema = z.object({
  to: z.array(z.string().email()).min(1),
  subject: z.string().min(1),
  message: z.string().min(1),
  headers: z.any().optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  threadId: z.string().optional(),
  fromEmail: z.string().optional(),
});

type EmailComposerForm = z.infer<typeof schema>;

export function EmailComposer({
  initialTo = [],
  initialCc = [],
  initialBcc = [],
  initialSubject = '',
  initialMessage = '',
  initialAttachments = [],
  initialAttachmentsLoading = false,
  initialAttachmentsError = null,
  onRetryInitialAttachments,
  onSendEmail,
  onClose,
  className,
  autofocus = false,
  settingsLoading = false,
  editorClassName,
}: EmailComposerProps) {
  const { data: aliases } = useEmailAliases();
  const { data: settings } = useSettings();
  const [showCc, setShowCc] = useState(initialCc.length > 0);
  const [showBcc, setShowBcc] = useState(initialBcc.length > 0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isComposeOpen, setIsComposeOpen] = useQueryState('isComposeOpen');
  const [draftId, setDraftId] = useQueryState('draftId');
  const [showLeaveConfirmation, setShowLeaveConfirmation] = useState(false);
  const [scheduleAt, setScheduleAt] = useState<string>();
  const [isScheduleValid, setIsScheduleValid] = useState<boolean>(true);
  const [showAttachmentWarning, setShowAttachmentWarning] = useState(false);
  const [activeReplyId] = useQueryState('activeReplyId');
  const [toggleToolbar, setToggleToolbar] = useState(false);

  const attachmentKeywords = [
    'attachment',
    'attached',
    'attaching',
    'see the file',
    'see the files',
  ];

  const { saveDraft: saveLocalDraft } = useMailDelivery();
  const onAttachmentsChanged = useCallback(() => {
    setHasUnsavedChanges(true);
  }, []);
  const {
    items: attachmentItems,
    uploadedFiles,
    hasPendingInitialAttachments,
    addAttachments,
    removeAttachment,
    retryAttachment,
  } = useAttachmentUploads({
    initialAttachments,
    onAttachmentsChanged,
  });
  const hasBlockingAttachments =
    initialAttachmentsLoading ||
    Boolean(initialAttachmentsError) ||
    hasPendingInitialAttachments ||
    attachmentUploadsBlockSend(attachmentItems);

  const form = useForm<EmailComposerForm>({
    // @hookform/resolvers and the workspace Zod version expose structurally
    // incompatible type declarations even though the runtime contract matches.
    resolver: zodResolver(schema as never) as Resolver<EmailComposerForm>,
    defaultValues: {
      to: initialTo,
      cc: initialCc,
      bcc: initialBcc,
      subject: initialSubject,
      message: initialMessage,
      fromEmail:
        settings?.settings?.defaultEmailAlias ||
        aliases?.find((alias) => alias.primary)?.email ||
        aliases?.[0]?.email ||
        '',
    },
  });

  const { watch, setValue, getValues } = form;
  const toEmails = watch('to');
  const ccEmails = watch('cc');
  const bccEmails = watch('bcc');
  const subjectInput = watch('subject');
  const fromEmail = watch('fromEmail');

  const handleAttachment = useCallback(
    (newFiles: File[]) => {
      addAttachments(newFiles);
    },
    [addAttachments],
  );

  const editor = useComposeEditor({
    initialValue: initialMessage,
    isReadOnly: isLoading,
    onLengthChange: () => {
      setHasUnsavedChanges(true);
    },
    onModEnter: () => {
      void handleSend();
      return true;
    },
    onAttachmentsChange: async (files) => {
      await handleAttachment(files);
    },
    placeholder: m['pages.createEmail.messagePlaceholder'](),
    autofocus,
  });

  // Add effect to focus editor when component mounts
  useEffect(() => {
    if (autofocus && editor) {
      const timeoutId = setTimeout(() => {
        editor.commands.focus('end');
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [editor, autofocus]);

  // Remove the TRPC query - we'll use the component's internal logic instead
  useEffect(() => {
    if (isComposeOpen === 'true' && editor) {
      editor.commands.focus();
    }
  }, [isComposeOpen, editor]);

  // Prevent browser navigation/refresh when there's unsaved content
  useEffect(() => {
    if (!editor) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasContent = editor?.getText()?.trim().length > 0;
      if (hasContent) {
        e.preventDefault();
        e.returnValue = ''; // Required for Chrome
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editor]);

  // Perhaps add `hasUnsavedChanges` to the condition
  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const hasContent = editor?.getText()?.trim().length > 0;
        if (hasContent && !draftId) {
          e.preventDefault();
          e.stopPropagation();
          setShowLeaveConfirmation(true);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true); // Use capture phase
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [editor, draftId]);

  const proceedWithSend = async () => {
    try {
      if (isLoading || isSavingDraft) return;

      if (hasBlockingAttachments) {
        toast.error(m['pages.createEmail.attachmentsNotReady']());
        return;
      }

      const values = getValues();

      // Validate recipient field
      if (!values.to || values.to.length === 0) {
        toast.error(m['pages.createEmail.recipientRequired']());
        return;
      }

      if (!isScheduleValid) {
        toast.error(m['pages.createEmail.invalidSchedule']());
        return;
      }

      setIsLoading(true);
      // Save draft before sending, we want to send drafts instead of sending new emails
      const savedDraft = hasUnsavedChanges ? await saveDraft() : undefined;

      await onSendEmail({
        to: values.to,
        cc: showCc ? values.cc : undefined,
        bcc: showBcc ? values.bcc : undefined,
        subject: values.subject,
        message: editor.getHTML(),
        attachments: uploadedFiles,
        fromEmail: values.fromEmail,
        scheduleAt,
        draftId: savedDraft?.id ?? draftId ?? undefined,
      });
      setHasUnsavedChanges(false);
      editor.commands.clearContent(true);
      form.reset();
      setIsComposeOpen(null);
    } catch (error) {
      console.error('Error sending email:', error);
      toast.error(m['pages.createEmail.failedToSend']());
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    const messageText = editor.getText().toLowerCase();
    const hasAttachmentKeywords = attachmentKeywords.some((keyword) => {
      const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
      return regex.test(messageText);
    });

    if (hasAttachmentKeywords && attachmentItems.length === 0) {
      setShowAttachmentWarning(true);
      return;
    }

    await proceedWithSend();
  };

  const saveDraft = useCallback(async () => {
    const values = getValues();

    if (!hasUnsavedChanges) return draftId ? { id: draftId } : undefined;
    if (hasBlockingAttachments) return draftId ? { id: draftId } : undefined;
    const messageText = editor.getText();

    if (!values.to.length || !values.subject.length || !messageText.length) {
      return draftId ? { id: draftId } : undefined;
    }
    try {
      setIsSavingDraft(true);
      const draftData = {
        to: values.to,
        cc: values.cc,
        bcc: values.bcc,
        subject: values.subject,
        htmlBody: editor.getHTML(),
        attachments: uploadedFiles,
        draftId,
        replyToEmailId: activeReplyId,
        fromEmail: values.fromEmail,
      };

      const response = await saveLocalDraft(draftData);

      if (response?.id && response.id !== draftId) {
        setDraftId(response.id);
      }
      return response;
    } catch (error) {
      console.error('Error saving draft:', error);
      toast.error(m['pages.createEmail.failedToSaveDraft']());
      setIsSavingDraft(false);
      setHasUnsavedChanges(false);
      return undefined;
    } finally {
      setIsSavingDraft(false);
      setHasUnsavedChanges(false);
    }
  }, [
    activeReplyId,
    draftId,
    editor,
    getValues,
    hasBlockingAttachments,
    hasUnsavedChanges,
    saveLocalDraft,
    setDraftId,
    uploadedFiles,
  ]);

  const handleClose = () => {
    const hasContent = editor?.getText()?.trim().length > 0;
    if (hasContent) {
      setShowLeaveConfirmation(true);
    } else {
      onClose?.();
    }
  };

  const confirmLeave = () => {
    setShowLeaveConfirmation(false);
    onClose?.();
  };

  const cancelLeave = () => {
    setShowLeaveConfirmation(false);
  };

  // Component unmount protection
  useEffect(() => {
    return () => {
      // This cleanup runs when component is about to unmount
      const hasContent = editor?.getText()?.trim().length > 0;
      if (hasContent && !showLeaveConfirmation) {
        // If we have content and haven't shown confirmation, it means
        // the component is being unmounted unexpectedly
        console.warn('Email composer unmounting with unsaved content');
      }
    };
  }, [editor, showLeaveConfirmation]);

  useEffect(() => {
    if (!hasUnsavedChanges || hasBlockingAttachments) return;

    const autoSaveTimer = setTimeout(() => {
      console.log('timeout set');
      saveDraft();
    }, 3000);

    return () => clearTimeout(autoSaveTimer);
  }, [hasBlockingAttachments, hasUnsavedChanges, saveDraft]);

  useEffect(() => {
    const handlePasteFiles = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData || !clipboardData.files.length) return;

      const pastedFiles = Array.from(clipboardData.files);
      if (pastedFiles.length > 0) {
        event.preventDefault();
        handleAttachment(pastedFiles);
        toast.success(m['pages.createEmail.filesAttached']({ count: pastedFiles.length }));
      }
    };

    document.addEventListener('paste', handlePasteFiles);
    return () => {
      document.removeEventListener('paste', handlePasteFiles);
    };
  }, [handleAttachment]);

  // keep fromEmail in sync when settings or aliases load afterwards
  useEffect(() => {
    const preferred =
      settings?.settings?.defaultEmailAlias ??
      aliases?.find((a) => a.primary)?.email ??
      aliases?.[0]?.email;

    if (preferred && getValues('fromEmail') !== preferred) {
      setValue('fromEmail', preferred, { shouldDirty: false });
    }
  }, [settings?.settings?.defaultEmailAlias, aliases, getValues, setValue]);

  const handleScheduleChange = useCallback((value?: string) => {
    setScheduleAt(value);
  }, []);

  const handleScheduleValidityChange = useCallback((valid: boolean) => {
    setIsScheduleValid(valid);
  }, []);

  const replaceEmojiShortcodes = (text: string): string => {
    if (!text.trim().length || !text.includes(':')) return text;
    return text.replace(shortcodeRegex, (match, shortcode): string => {
      const emoji = gitHubEmojis.find(
        (e) => e.shortcodes.includes(shortcode) || e.name === shortcode,
      );
      return emoji?.emoji ?? match;
    });
  };

  return (
    <div
      className={cn(
        'flex max-h-[500px] w-full max-w-[750px] flex-col overflow-hidden rounded-2xl bg-[#FAFAFA] shadow-sm dark:bg-[#202020]',
        className,
      )}
    >
      <div className="no-scrollbar dark:bg-panelDark flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl">
        {/* To, Cc, Bcc */}
        <div className="shrink-0 overflow-visible border-b border-[#E7E7E7] pb-2 dark:border-[#252525]">
          <div className="flex justify-between px-3 pt-3">
            <div className="flex w-full items-center gap-2">
              <p className="text-sm font-medium text-[#8C8C8C]">{m['pages.createEmail.to']()}</p>
              <RecipientAutosuggest
                control={form.control}
                name="to"
                placeholder={m['pages.createEmail.enterEmail']()}
                disabled={isLoading}
              />
            </div>

            <div className="flex gap-2">
              <button
                tabIndex={-1}
                className="flex h-full cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-sm font-medium text-[#8C8C8C] transition-colors hover:bg-gray-50 hover:text-[#A8A8A8] dark:hover:bg-[#404040]"
                onClick={() => setShowCc(!showCc)}
              >
                <span>{m['pages.createEmail.cc']()}</span>
              </button>
              <button
                tabIndex={-1}
                className="flex h-full cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-sm font-medium text-[#8C8C8C] transition-colors hover:bg-gray-50 hover:text-[#A8A8A8] dark:hover:bg-[#404040]"
                onClick={() => setShowBcc(!showBcc)}
              >
                <span>{m['pages.createEmail.bcc']()}</span>
              </button>
              {onClose && (
                <button
                  tabIndex={-1}
                  className="flex h-full cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-sm font-medium text-[#8C8C8C] transition-colors hover:bg-gray-50 hover:text-[#A8A8A8] dark:hover:bg-[#404040]"
                  onClick={handleClose}
                >
                  <X className="h-3.5 w-3.5 fill-[#9A9A9A]" />
                </button>
              )}
            </div>
          </div>

          <div className={`flex flex-col gap-2 ${showCc || showBcc ? 'pt-2' : ''}`}>
            {/* CC Section */}
            {showCc && (
              <div className="flex items-center gap-2 px-3">
                <p className="text-sm font-medium text-[#8C8C8C]">
                  {m['pages.createEmail.ccWithColon']()}
                </p>
                <RecipientAutosuggest
                  control={form.control}
                  name="cc"
                  placeholder={m['pages.createEmail.enterCc']()}
                  disabled={isLoading}
                />
              </div>
            )}

            {/* BCC Section */}
            {showBcc && (
              <div className="flex items-center gap-2 px-3">
                <p className="text-sm font-medium text-[#8C8C8C]">
                  {m['pages.createEmail.bccWithColon']()}
                </p>
                <RecipientAutosuggest
                  control={form.control}
                  name="bcc"
                  placeholder={m['pages.createEmail.enterBcc']()}
                  disabled={isLoading}
                />
              </div>
            )}
          </div>
        </div>

        {/* Subject */}
        {!activeReplyId ? (
          <div className="flex items-center gap-2 border-b p-3">
            <p className="text-sm font-medium text-[#8C8C8C]">{m['pages.createEmail.subject']()}</p>
            <input
              className="h-4 w-full bg-transparent text-sm font-normal leading-normal text-black placeholder:text-[#797979] focus:outline-none dark:text-white/90"
              placeholder={m['pages.createEmail.subjectPlaceholder']()}
              value={subjectInput}
              onChange={(e) => {
                const value = replaceEmojiShortcodes(e.target.value);
                setValue('subject', value);
                setHasUnsavedChanges(true);
              }}
            />
          </div>
        ) : null}

        {/* From */}
        {aliases && aliases.length > 1 ? (
          <div className="flex items-center gap-2 border-b p-3">
            <p className="text-sm font-medium text-[#8C8C8C]">{m['pages.createEmail.from']()}</p>
            <Select
              value={fromEmail || ''}
              onValueChange={(value) => {
                setValue('fromEmail', value);
                setHasUnsavedChanges(true);
              }}
            >
              <SelectTrigger className="h-6 flex-1 border-0 bg-transparent p-0 text-sm font-normal text-black placeholder:text-[#797979] focus:outline-none focus:ring-0 dark:text-white/90">
                <SelectValue placeholder={m['pages.createEmail.selectEmail']()} />
              </SelectTrigger>
              <SelectContent className="z-99999">
                {aliases.map((alias) => (
                  <SelectItem key={alias.email} value={alias.email}>
                    <div className="flex flex-row items-center gap-1">
                      <span className="text-sm">
                        {alias.name ? `${alias.name} <${alias.email}>` : alias.email}
                      </span>
                      {alias.primary && (
                        <span className="text-xs text-[#8C8C8C]">
                          {m['pages.createEmail.primary']()}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {/* Message Content */}
        <div className="flex-1 overflow-y-auto border-t bg-[#FFFFFF] px-3 py-3 outline-white/5 dark:bg-[#202020]">
          <div
            onClick={() => {
              editor.commands.focus();
            }}
            className={cn(`min-h-[200px] w-full`, editorClassName)}
          >
            <EditorContent editor={editor} className="h-full w-full max-w-full overflow-x-auto" />
          </div>
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="inline-flex w-full shrink-0 items-end justify-between self-stretch rounded-b-2xl bg-[#FFFFFF] px-3 py-3 outline-white/5 dark:bg-[#202020]">
        <div className="flex w-full flex-col items-start justify-start gap-2">
          {initialAttachmentsLoading ? (
            <div
              className="text-muted-foreground flex items-center gap-2 text-sm"
              aria-live="polite"
            >
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>{m['pages.createEmail.attachmentDownloading']()}</span>
            </div>
          ) : initialAttachmentsError ? (
            <div
              className="flex w-full max-w-[560px] items-center justify-between gap-3 rounded-xl border border-red-500 bg-red-50/60 px-3 py-2 text-sm text-red-700 dark:bg-red-950/20 dark:text-red-400"
              role="alert"
            >
              <span>{m['pages.createEmail.attachmentDownloadFailed']()}</span>
              {onRetryInitialAttachments ? (
                <button
                  type="button"
                  onClick={onRetryInitialAttachments}
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 font-medium hover:underline"
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                  {m['pages.createEmail.retryAttachmentDownload']()}
                </button>
              ) : null}
            </div>
          ) : null}
          <AttachmentUploadList
            items={attachmentItems}
            onRemove={removeAttachment}
            onRetry={retryAttachment}
          />
          {toggleToolbar && <Toolbar editor={editor} />}
          <div className="flex items-center justify-start gap-2">
            <Button
              size={'xs'}
              onClick={handleSend}
              disabled={isLoading || settingsLoading || !isScheduleValid || hasBlockingAttachments}
            >
              <div className="flex items-center justify-center">
                <div className="text-center text-sm leading-none text-white dark:text-black">
                  <span>{m['common.replyCompose.send']()} </span>
                </div>
              </div>
              <div className="flex h-5 items-center justify-center gap-1 rounded-sm bg-white/10 px-1 dark:bg-black/10">
                <Command className="h-3.5 w-3.5 text-white dark:text-black" />
                <CurvedArrow className="mt-1.5 h-4 w-4 fill-white dark:fill-black" />
              </div>
            </Button>
            <ScheduleSendPicker
              value={scheduleAt}
              onChange={handleScheduleChange}
              onValidityChange={handleScheduleValidityChange}
            />
            <Button
              variant={'secondary'}
              size={'xs'}
              onClick={() => fileInputRef.current?.click()}
              className="bg-background cursor-pointer border transition-colors hover:bg-gray-50 dark:hover:bg-[#404040]"
            >
              <Paperclip className="h-3.5 w-3.5 text-[#9A9A9A]" />
              <span className="hidden px-0.5 text-sm md:block">
                {m['pages.createEmail.attachmentsLabel']()}
              </span>
            </Button>
            <TemplateButton
              editor={editor}
              subject={subjectInput}
              setSubject={(value) => setValue('subject', value)}
              to={toEmails}
              cc={ccEmails ?? []}
              bcc={bccEmails ?? []}
              setRecipients={(field, val) => setValue(field, val)}
            />
            <Input
              type="file"
              id="attachment-input"
              className="hidden"
              onChange={async (event) => {
                const fileList = event.target.files;
                if (fileList) {
                  await handleAttachment(Array.from(fileList));
                }
                event.target.value = '';
              }}
              multiple
              ref={fileInputRef}
              style={{ zIndex: 100 }}
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    tabIndex={-1}
                    variant="ghost"
                    size="icon"
                    onClick={() => setToggleToolbar(!toggleToolbar)}
                    className={`h-auto w-auto rounded p-1.5 ${toggleToolbar ? 'bg-muted' : 'bg-background'} cursor-pointer border transition-colors hover:bg-gray-50 dark:hover:bg-[#404040]`}
                  >
                    <Type className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{m['pages.createEmail.formattingOptions']()}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>

      <Dialog open={showLeaveConfirmation} onOpenChange={setShowLeaveConfirmation}>
        <DialogContent showOverlay className="z-99999 sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{m['pages.createEmail.discardTitle']()}</DialogTitle>
            <DialogDescription>{m['pages.createEmail.discardDescription']()}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={cancelLeave} className="cursor-pointer">
              {m['pages.createEmail.stay']()}
            </Button>
            <Button variant="destructive" onClick={confirmLeave} className="cursor-pointer">
              {m['pages.createEmail.leave']()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAttachmentWarning} onOpenChange={setShowAttachmentWarning}>
        <DialogContent showOverlay className="z-99999 sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{m['pages.createEmail.attachmentWarningTitle']()}</DialogTitle>
            <DialogDescription>
              {m['pages.createEmail.attachmentWarningDescription']()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowAttachmentWarning(false);
              }}
              className="cursor-pointer"
            >
              {m['pages.createEmail.recheck']()}
            </Button>
            <Button
              onClick={() => {
                setShowAttachmentWarning(false);
                void proceedWithSend();
              }}
              className="cursor-pointer"
            >
              {m['pages.createEmail.sendAnyway']()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
