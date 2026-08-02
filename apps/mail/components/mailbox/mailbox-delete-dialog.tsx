import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Mailbox } from '@/modules/mail/model/mailbox';

import { getMailboxDeleteConstraint } from './mailbox-settings-domain';

export function MailboxDeleteDialog({
  mailbox,
  mailboxes,
  onOpenChange,
  onConfirm,
  isPending,
}: {
  mailbox: Mailbox | null;
  mailboxes: readonly Mailbox[];
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  isPending: boolean;
}) {
  const constraint = mailbox ? getMailboxDeleteConstraint(mailbox, mailboxes) : null;
  return (
    <Dialog open={mailbox !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除{mailbox?.kind === 'folder' ? '文件夹' : '标签'}</DialogTitle>
          <DialogDescription>
            {constraint ??
              (mailbox?.kind === 'label'
                ? '标签会从相关邮件中解除，邮件和主要文件夹不会被删除。'
                : '此操作无法撤销。')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" disabled={Boolean(constraint) || isPending} onClick={onConfirm}>
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
