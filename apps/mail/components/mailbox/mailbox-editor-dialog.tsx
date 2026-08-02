import { useEffect, useMemo, useState } from 'react';

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
import type { CustomMailboxKind, Mailbox } from '@/modules/mail/model/mailbox';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { m } from '@/paraglide/messages';

import { getMailboxParentOptions, validateMailboxEditorInput } from './mailbox-settings-domain';

const ROOT_PARENT = '__root__';

export type MailboxEditorValue = {
  name: string;
  parentId: string | null;
  color: string | null;
  isSubscribed: boolean;
};

export function MailboxEditorDialog({
  open,
  onOpenChange,
  kind,
  mailbox,
  mailboxes,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: CustomMailboxKind;
  mailbox: Mailbox | null;
  mailboxes: readonly Mailbox[];
  onSubmit: (value: MailboxEditorValue) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const parentOptions = useMemo(
    () => getMailboxParentOptions(mailboxes, kind, mailbox?.id ?? null),
    [kind, mailbox?.id, mailboxes],
  );

  useEffect(() => {
    if (!open) return;
    setName(mailbox?.name ?? '');
    setParentId(mailbox?.parentId ?? null);
    setColor(mailbox?.color ?? null);
    setIsSubscribed(mailbox?.isSubscribed ?? true);
    setError(null);
  }, [mailbox, open]);

  const save = async () => {
    const validation = validateMailboxEditorInput({
      mailboxes,
      kind,
      editingId: mailbox?.id ?? null,
      name,
      parentId,
    });
    if (!validation.ok) {
      switch (validation.code) {
        case 'NAME_REQUIRED':
          setError(m['common.mailboxes.nameRequired']());
          break;
        case 'PARENT_KIND_MISMATCH':
          setError(m['common.mailboxes.parentKindMismatch']());
          break;
        case 'PARENT_CYCLE':
          setError(m['common.mailboxes.parentCycle']());
          break;
        case 'SIBLING_NAME_CONFLICT':
          setError(m['common.mailboxes.siblingNameConflict']());
          break;
        case 'MAX_DEPTH_EXCEEDED':
          setError(m['common.mailboxes.maxDepthExceeded']({ maxDepth: validation.maxDepth }));
          break;
      }
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        name: validation.name,
        parentId: validation.parentId,
        color: kind === 'label' ? color : null,
        isSubscribed,
      });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m['common.mailboxes.operationFailed']());
    } finally {
      setSaving(false);
    }
  };

  const kindName =
    kind === 'folder' ? m['common.mailboxes.folder']() : m['common.mailboxes.label']();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mailbox
              ? m['common.mailboxes.editItem']({ kind: kindName })
              : m['common.mailboxes.createItem']({ kind: kindName })}
          </DialogTitle>
          <DialogDescription>{m['common.mailboxes.localOnlyDescription']()}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="mailbox-name">{m['common.mailboxes.name']()}</Label>
            <Input
              id="mailbox-name"
              value={name}
              maxLength={255}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{m['common.mailboxes.parent']()}</Label>
            <Select
              value={parentId ?? ROOT_PARENT}
              onValueChange={(value) => setParentId(value === ROOT_PARENT ? null : value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT_PARENT}>{m['common.mailboxes.root']()}</SelectItem>
                {parentOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {kind === 'label' ? (
            <div className="space-y-2">
              <Label htmlFor="mailbox-color">{m['common.mailboxes.color']()}</Label>
              <Input
                id="mailbox-color"
                type="color"
                value={color ?? '#64748b'}
                onChange={(event) => setColor(event.target.value)}
              />
            </div>
          ) : null}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{m['common.mailboxes.showInSidebar']()}</p>
              <p className="text-muted-foreground text-xs">
                {m['common.mailboxes.showInSidebarDescription']()}
              </p>
            </div>
            <Switch checked={isSubscribed} onCheckedChange={setIsSubscribed} />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {m['common.actions.cancel']()}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? m['common.actions.saving']() : m['common.actions.save']()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
