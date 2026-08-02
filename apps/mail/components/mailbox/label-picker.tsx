import { useMemo, useState, type MouseEvent } from 'react';
import { Loader2, Search, Tags } from 'lucide-react';
import { toast } from 'sonner';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { labelSelectionState } from '@/modules/mail/selectors/mailbox-selection';
import { buildMailboxTree } from '@/modules/mail/selectors/mailbox-tree';
import { useOptimisticActions } from '@/hooks/use-optimistic-actions';
import { useMailboxes } from '@/modules/mail/queries/use-mailboxes';
import type { MailboxTreeNode } from '@/modules/mail/model/mailbox';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { m } from '@/paraglide/messages';
import { cn } from '@/lib/utils';

import { buildLabelMutation, nextLabelSelectionState } from './mail-action-menu-domain';

export type LabelPickerProps = {
  threadIds: string[];
  threadMailboxIds: string[][];
  className?: string;
  label?: string;
};

type FlatLabel = { mailbox: MailboxTreeNode; depth: number };

const flattenTree = (nodes: readonly MailboxTreeNode[], depth = 0): FlatLabel[] =>
  nodes.flatMap((node) => [{ mailbox: node, depth }, ...flattenTree(node.children, depth + 1)]);

export function LabelPicker({ threadIds, threadMailboxIds, className, label }: LabelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState(false);
  const { mailboxes } = useMailboxes();
  const { setThreadLabels } = useOptimisticActions();
  const labels = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return flattenTree(buildMailboxTree(mailboxes, { kind: 'label' })).filter(
      ({ mailbox }) =>
        normalizedSearch.length === 0 ||
        mailbox.name.toLocaleLowerCase().includes(normalizedSearch),
    );
  }, [mailboxes, search]);
  const mutation = useMemo(() => buildLabelMutation(changes, mailboxes), [changes, mailboxes]);
  const hasChanges = mutation.addLabelIds.length > 0 || mutation.removeLabelIds.length > 0;

  const setPickerOpen = (nextOpen: boolean) => {
    if (pending) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearch('');
      setChanges({});
    }
  };

  const toggle = (labelId: string) => {
    const initialState = labelSelectionState(labelId, threadMailboxIds);
    const currentState = labelId in changes ? (changes[labelId] ? 'all' : 'none') : initialState;
    setChanges((current) => ({
      ...current,
      [labelId]: nextLabelSelectionState(currentState),
    }));
  };

  const apply = async () => {
    if (!hasChanges || pending) return;
    setPending(true);
    try {
      await setThreadLabels(threadIds, mutation.addLabelIds, mutation.removeLabelIds);
      toast.success(m['common.mailboxes.labelsUpdated']());
      setOpen(false);
      setSearch('');
      setChanges({});
    } catch (error) {
      console.error('Failed to update thread labels:', error);
      toast.error(m['common.mailboxes.labelsUpdateFailed']());
    } finally {
      setPending(false);
    }
  };

  const stopPropagation = (event: MouseEvent) => event.stopPropagation();

  return (
    <Popover open={open} onOpenChange={setPickerOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={label ? 'sm' : 'icon'}
          className={cn('h-8', !label && 'w-8', className)}
          aria-label={m['common.mailboxes.manageLabels']()}
          onClick={stopPropagation}
          disabled={threadIds.length === 0}
        >
          <Tags className="h-4 w-4" />
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
            placeholder={m['common.mailboxes.searchLabels']()}
            className="h-9 pl-8"
            autoFocus
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {labels.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              {m['common.mailboxes.noLabelsAvailable']()}
            </p>
          ) : (
            labels.map(({ mailbox, depth }) => {
              const state =
                mailbox.id in changes
                  ? changes[mailbox.id]
                    ? 'all'
                    : 'none'
                  : labelSelectionState(mailbox.id, threadMailboxIds);
              return (
                <button
                  key={mailbox.id}
                  type="button"
                  className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm"
                  style={{ paddingLeft: `${8 + depth * 16}px` }}
                  disabled={pending}
                  onClick={() => toggle(mailbox.id)}
                >
                  <Checkbox
                    checked={state === 'partial' ? 'indeterminate' : state === 'all'}
                    tabIndex={-1}
                    aria-label={mailbox.name}
                  />
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: mailbox.color ?? 'currentColor' }}
                  />
                  <span className="truncate">{mailbox.name}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="mt-2 flex justify-end gap-2 border-t pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setPickerOpen(false)}>
            {m['common.actions.cancel']()}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!hasChanges || pending}
            onClick={() => void apply()}
          >
            {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {m['common.mailboxes.apply']()}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
