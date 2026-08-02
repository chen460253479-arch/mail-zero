import { FolderInput, Loader2, Search } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { toast } from 'sonner';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useOptimisticActions } from '@/hooks/use-optimistic-actions';
import { useMailboxes } from '@/modules/mail/queries/use-mailboxes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { m } from '@/paraglide/messages';
import { cn } from '@/lib/utils';

import { getMailboxDisplayName, type SystemMailboxDisplayNames } from './mailbox-display-name';
import { buildMoveTargets } from './mail-action-menu-domain';
import { IconActionTooltip } from './icon-action-tooltip';

export type MoveToFolderMenuProps = {
  threadIds: string[];
  currentMailboxId: string | null;
  className?: string;
  label?: string;
};

export function MoveToFolderMenu({
  threadIds,
  currentMailboxId,
  className,
  label,
}: MoveToFolderMenuProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pendingMailboxId, setPendingMailboxId] = useState<string | null>(null);
  const { mailboxes } = useMailboxes();
  const { moveThreadsToMailbox } = useOptimisticActions();
  const systemMailboxDisplayNames = {
    inbox: m['navigation.sidebar.inbox'](),
    archive: m['navigation.sidebar.archive'](),
    junk: m['navigation.sidebar.spam'](),
    trash: m['navigation.sidebar.bin'](),
  } satisfies SystemMailboxDisplayNames;
  const targets = buildMoveTargets(mailboxes, currentMailboxId, search, (mailbox) =>
    getMailboxDisplayName(mailbox, systemMailboxDisplayNames),
  );

  const setMenuOpen = (nextOpen: boolean) => {
    if (pendingMailboxId) return;
    setOpen(nextOpen);
    if (!nextOpen) setSearch('');
  };

  const move = async (destinationMailboxId: string) => {
    if (pendingMailboxId || threadIds.length === 0) return;
    setPendingMailboxId(destinationMailboxId);
    try {
      if (!currentMailboxId) throw new Error('MAIL_SOURCE_MAILBOX_UNAVAILABLE');
      await moveThreadsToMailbox(threadIds, currentMailboxId, destinationMailboxId);
      toast.success(m['common.mailboxes.messageMoved']());
      setOpen(false);
      setSearch('');
    } catch (error) {
      console.error('Failed to move threads:', error);
      toast.error(m['common.mailboxes.moveFailed']());
    } finally {
      setPendingMailboxId(null);
    }
  };

  const stopPropagation = (event: MouseEvent) => event.stopPropagation();

  return (
    <Popover open={open} onOpenChange={setMenuOpen}>
      <IconActionTooltip label={label} tooltip={m['common.mailboxes.moveToFolder']()}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={label ? 'sm' : 'icon'}
            className={cn('h-8', !label && 'w-8', className)}
            aria-label={m['common.mailboxes.moveToFolder']()}
            onClick={stopPropagation}
            disabled={threadIds.length === 0}
          >
            <FolderInput className="h-4 w-4" />
            {label ? <span>{label}</span> : null}
          </Button>
        </PopoverTrigger>
      </IconActionTooltip>
      <PopoverContent
        align="end"
        className="w-72 p-2"
        onClick={stopPropagation}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="relative mb-2">
          <Search className="text-muted-foreground absolute left-2.5 top-2.5 h-4 w-4" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={m['common.mailboxes.searchFolders']()}
            className="h-9 pl-8"
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {targets.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              {m['common.mailboxes.noMoveTargets']()}
            </p>
          ) : (
            targets.map(({ mailbox, depth, displayName }) => (
              <button
                key={mailbox.id}
                type="button"
                className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm disabled:opacity-50"
                style={{ paddingLeft: `${8 + depth * 16}px` }}
                disabled={pendingMailboxId !== null}
                onClick={() => void move(mailbox.id)}
              >
                {pendingMailboxId === mailbox.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderInput className="text-muted-foreground h-4 w-4" />
                )}
                <span className="truncate">{displayName}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
