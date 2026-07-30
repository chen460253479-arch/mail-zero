import { useTemplates } from '@/hooks/use-templates';
import { useTRPC } from '@/providers/query-provider';
import { Editor } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Save, Trash2 } from 'lucide-react';
import React, { useState, useMemo, useDeferredValue, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TRPCClientError } from '@trpc/client';
import { m } from '@/paraglide/messages';

type EmailTemplate = {
  id: string;
  userId: string;
  name: string;
  subject: string | null;
  body: string | null;
  to: string[] | null;
  cc: string[] | null;
  bcc: string[] | null;
  createdAt: Date;
  updatedAt: Date;
};

type RecipientField = 'to' | 'cc' | 'bcc';

interface TemplateButtonProps {
  editor: Editor | null;
  subject: string;
  setSubject: (value: string) => void;
  to: string[];
  cc: string[];
  bcc: string[];
  setRecipients: (field: RecipientField, value: string[]) => void;
}

const TemplateButtonComponent: React.FC<TemplateButtonProps> = ({
  editor,
  subject,
  setSubject,
  to,
  cc,
  bcc,
  setRecipients,
}) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data } = useTemplates();
  
  const templates = (data?.templates ?? []) as EmailTemplate[];

  const [menuOpen, setMenuOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [search, setSearch] = useState('');

  const deferredSearch = useDeferredValue(search);

  const filteredTemplates = useMemo(() => {
    if (!deferredSearch.trim()) return templates;
    return templates.filter((t) =>
      t.name.toLowerCase().includes(deferredSearch.toLowerCase()),
    );
  }, [deferredSearch, templates]);

  const templatesById = useMemo(() => {
    return new Map(templates.map((t) => [t.id, t] as const));
  }, [templates]);

  const { mutateAsync: createTemplate } = useMutation(trpc.templates.create.mutationOptions());
  const { mutateAsync: deleteTemplateMutation } = useMutation(
    trpc.templates.delete.mutationOptions(),
  );

  const handleSaveTemplate = async () => {
    if (!editor) return;
    if (!templateName.trim()) {
      toast.error(m['pages.createEmail.templates.nameRequired']());
      return;
    }

    setIsSaving(true);
    try {
      const normalizedSubject = subject.trim() ? subject : null;
      await createTemplate({
        name: templateName.trim(),
        body: editor.getHTML(),
        to: to.length ? to : undefined,
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
        ...(normalizedSubject !== null ? { subject: normalizedSubject } : {}),
      });
      await queryClient.invalidateQueries({
        queryKey: trpc.templates.list.queryKey(),
      });
      toast.success(m['pages.createEmail.templates.saved']());
      setTemplateName('');
      setSaveDialogOpen(false);
    } catch (error) {
      if (error instanceof TRPCClientError) {
        toast.error(error.message);
      } else {
        toast.error(m['pages.createEmail.templates.saveFailed']());
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyTemplate = useCallback((template: EmailTemplate) => {
    if (!editor) return;
    
    if (template.subject) setSubject(template.subject);
    if (template.body) editor.commands.setContent(template.body, false);
    if (template.to) setRecipients('to', template.to);
    if (template.cc) setRecipients('cc', template.cc);
    if (template.bcc) setRecipients('bcc', template.bcc);
    
    setTimeout(() => {
      editor.chain().focus('end').run();
    }, 200);
  }, [editor, setSubject, setRecipients]);

  const handleDeleteTemplate = useCallback(
    async (templateId: string) => {
      try {
        await deleteTemplateMutation({ id: templateId });
        await queryClient.invalidateQueries({
          queryKey: trpc.templates.list.queryKey(),
        });
        toast.success(m['pages.createEmail.templates.deleted']());
      } catch (err) {
        if (err instanceof TRPCClientError) {
          toast.error(err.message);
        } else {
          toast.error(m['pages.createEmail.templates.deleteFailed']());
        }
      }
    },
    [deleteTemplateMutation, queryClient, trpc.templates.list],
  );

  const handleTemplateItemClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const templateId = (e.currentTarget as HTMLElement).dataset.templateId;
      if (!templateId) return;
      const template = templatesById.get(templateId);
      if (!template) return;
      handleApplyTemplate(template);
      setMenuOpen(false);
    },
    [handleApplyTemplate, templatesById],
  );

  const handleDeleteButtonClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setMenuOpen(false);
      const templateId = (e.currentTarget as HTMLButtonElement).dataset.templateId;
      if (!templateId) return;
      const template = templatesById.get(templateId);
      const templateName = template?.name ?? m['pages.createEmail.templates.unnamed']();
      toast(m['pages.createEmail.templates.deleteConfirm']({ name: templateName }), {
        duration: 10000,
        action: {
          label: m['pages.createEmail.templates.delete'](),
          onClick: () => handleDeleteTemplate(templateId),
        },
        className: 'pointer-events-auto',
        style: {
          pointerEvents: 'auto',
        },
      });
    },
    [templatesById, handleDeleteTemplate],
  );

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button type="button" size={'xs'} variant={'secondary'} className="bg-background border hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors cursor-pointer" disabled={isSaving}>
            {m['pages.createEmail.templates.title']()}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="z-99999 w-60" align="start" sideOffset={6}>
          <DropdownMenuItem
            onSelect={() => {
              setMenuOpen(false);
              setSaveDialogOpen(true);
            }}
            disabled={isSaving}
          >
            <Save className="mr-2 h-3.5 w-3.5" />{' '}
            {m['pages.createEmail.templates.saveCurrent']()}
          </DropdownMenuItem>
           {templates.length > 0 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FileText className="mr-2 h-3.5 w-3.5" />{' '}
                {m['pages.createEmail.templates.use']()}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="z-99999 w-60">
                <div className="p-2 border-b border-border sticky top-0 bg-background">
                  <Input
                    placeholder={m['pages.createEmail.templates.search']()}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-8 text-sm"
                    autoFocus
                  />
                </div>
                <div className="max-h-30 overflow-y-auto">
                  {filteredTemplates.map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      data-template-id={t.id}
                      className="flex items-center justify-between gap-2"
                      onClick={handleTemplateItemClick}
                    >
                      <span className="flex-1 truncate text-left">{t.name}</span>
                      <button
                        className="p-0.5 text-muted-foreground hover:text-destructive"
                        data-template-id={t.id}
                        onClick={handleDeleteButtonClick}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuItem>
                  ))}
                  {filteredTemplates.length === 0 && (
                    <div className="p-2 text-xs text-muted-foreground">{m['pages.createEmail.templates.empty']()}</div>
                  )}
                </div>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent showOverlay>
          <DialogHeader>
            <DialogTitle>{m['pages.createEmail.templates.saveAs']()}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Input
              placeholder={m['pages.createEmail.templates.namePlaceholder']()}
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSaveDialogOpen(false)}
            >
              {m['common.actions.cancel']()}
            </Button>
            <Button size="sm" onClick={handleSaveTemplate} disabled={isSaving}>
              {m['common.actions.save']()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export const TemplateButton = React.memo(TemplateButtonComponent);
