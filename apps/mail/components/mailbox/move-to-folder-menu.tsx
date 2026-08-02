import { FolderInput, Loader2, Search } from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import { toast } from 'sonner';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useOptimisticActions } from '@/hooks/use-optimistic-actions';
import { useMailboxes } from '@/modules/mail/queries/use-mailboxes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { buildMoveTargets } from './mail-action-menu-domain';

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
  const targets = useMemo(
    () => buildMoveTargets(mailboxes, currentMailboxId, search),
    [currentMailboxId, mailboxes, search],
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
      await moveThreadsToMailbox(threadIds, destinationMailboxId);
      toast.success('邮件已移动');
      setOpen(false);
      setSearch('');
    } catch (error) {
      console.error('Failed to move threads:', error);
      toast.error('移动邮件失败，请重试');
    } finally {
      setPendingMailboxId(null);
    }
  };

  const stopPropagation = (event: MouseEvent) => event.stopPropagation();

  return (
    <Popover open={open} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={label ? 'sm' : 'icon'}
          className={cn('h-8', !label && 'w-8', className)}
          aria-label="移动到文件夹"
          onClick={stopPropagation}
          disabled={threadIds.length === 0}
        >
          <FolderInput className="h-4 w-4" />
          {label ? <span>{label}</span> : null}
        </Button>
      </PopoverTrigger>
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
            placeholder="搜索文件夹"
            className="h-9 pl-8"
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {targets.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              没有可移动的文件夹
            </p>
          ) : (
            targets.map(({ mailbox, depth }) => (
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
                <span className="truncate">{mailbox.name}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
