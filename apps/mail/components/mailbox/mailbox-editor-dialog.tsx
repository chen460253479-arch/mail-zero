import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { CustomMailboxKind, Mailbox } from '@/modules/mail/model/mailbox';

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
      setError(validation.message);
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
      setError(cause instanceof Error ? cause.message : '邮箱操作失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  const kindName = kind === 'folder' ? '文件夹' : '标签';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mailbox ? `编辑${kindName}` : `创建${kindName}`}</DialogTitle>
          <DialogDescription>名称和层级只保存在 Zero 本地邮箱中。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="mailbox-name">名称</Label>
            <Input
              id="mailbox-name"
              value={name}
              maxLength={255}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>父级</Label>
            <Select
              value={parentId ?? ROOT_PARENT}
              onValueChange={(value) => setParentId(value === ROOT_PARENT ? null : value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT_PARENT}>根级</SelectItem>
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
              <Label htmlFor="mailbox-color">颜色</Label>
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
              <p className="text-sm font-medium">在侧边栏显示</p>
              <p className="text-muted-foreground text-xs">关闭后仍可在此设置页管理。</p>
            </div>
            <Switch checked={isSubscribed} onCheckedChange={setIsSubscribed} />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
