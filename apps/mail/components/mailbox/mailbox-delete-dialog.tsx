import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Mailbox } from '@/modules/mail/model/mailbox';
import { Button } from '@/components/ui/button';
import { m } from '@/paraglide/messages';

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
  const constraintMessage =
    constraint === 'SYSTEM_MAILBOX'
      ? m['common.mailboxes.systemMailboxProtected']()
      : constraint === 'HAS_CHILDREN'
        ? m['common.mailboxes.hasChildren']()
        : constraint === 'FOLDER_HAS_MAIL'
          ? m['common.mailboxes.folderHasMail']()
          : null;
  const kindName =
    mailbox?.kind === 'folder' ? m['common.mailboxes.folder']() : m['common.mailboxes.label']();
  return (
    <Dialog open={mailbox !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m['common.mailboxes.deleteItem']({ kind: kindName })}</DialogTitle>
          <DialogDescription>
            {constraintMessage ??
              (mailbox?.kind === 'label'
                ? m['common.mailboxes.labelDeleteDescription']()
                : m['common.mailboxes.irreversible']())}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {m['common.actions.cancel']()}
          </Button>
          <Button
            variant="destructive"
            disabled={Boolean(constraint) || isPending}
            onClick={onConfirm}
          >
            {m['common.actions.confirmDelete']()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
