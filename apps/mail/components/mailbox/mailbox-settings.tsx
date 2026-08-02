import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ExternalLink, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useEffect, useMemo, useState } from 'react';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';

import type { CustomMailboxKind, Mailbox, MailboxTreeNode } from '@/modules/mail/model/mailbox';
import { mailboxErrorMessage } from '@/modules/mail/mutations/mailbox-error-message';
import { useMailboxActions } from '@/modules/mail/mutations/use-mailbox-actions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { buildMailboxTree } from '@/modules/mail/selectors/mailbox-tree';
import { useMailboxes } from '@/modules/mail/queries/use-mailboxes';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { m } from '@/paraglide/messages';

import { MailboxEditorDialog, type MailboxEditorValue } from './mailbox-editor-dialog';
import { MailboxDeleteDialog } from './mailbox-delete-dialog';
import { mailboxNodeHref } from './mailbox-tree-node';

export {
  getMailboxDeleteConstraint,
  getMailboxParentOptions,
  reorderMailboxSiblings,
  validateMailboxEditorInput,
} from './mailbox-settings-domain';
import { reorderMailboxSiblings } from './mailbox-settings-domain';

type FlatMailbox = { mailbox: Mailbox; depth: number };

const flattenTree = (nodes: readonly MailboxTreeNode[], depth = 0): FlatMailbox[] =>
  nodes.flatMap((node) => [{ mailbox: node, depth }, ...flattenTree(node.children, depth + 1)]);

export function MailboxSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'labels' ? 'labels' : 'folders';
  const kind: CustomMailboxKind = tab === 'labels' ? 'label' : 'folder';
  const { mailboxes, isLoading } = useMailboxes();
  const { createMailbox, updateMailbox, updateMailboxes, destroyMailbox, isPending } =
    useMailboxActions();
  const [editorKind, setEditorKind] = useState<CustomMailboxKind | null>(null);
  const [editingMailbox, setEditingMailbox] = useState<Mailbox | null>(null);
  const [deletingMailbox, setDeletingMailbox] = useState<Mailbox | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const rows = useMemo(() => flattenTree(buildMailboxTree(mailboxes, { kind })), [kind, mailboxes]);

  useEffect(() => {
    if (searchParams.get('create') !== 'true') return;
    setEditorKind(kind);
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    setSearchParams(next, { replace: true });
  }, [kind, searchParams, setSearchParams]);

  const setTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: true });
  };

  const saveMailbox = async (value: MailboxEditorValue) => {
    try {
      if (editingMailbox) {
        await updateMailbox({ id: editingMailbox.id, ...value });
      } else if (editorKind) {
        await createMailbox({ kind: editorKind, sortOrder: rows.length * 10, ...value });
      }
      toast.success(m['common.mailboxes.saved']());
    } catch (error) {
      throw new Error(mailboxErrorMessage(error instanceof Error ? error.message : 'UNKNOWN'));
    }
  };

  const toggleSubscribed = async (mailbox: Mailbox, checked: boolean) => {
    try {
      await updateMailbox({ id: mailbox.id, isSubscribed: checked });
    } catch (error) {
      toast.error(mailboxErrorMessage(error instanceof Error ? error.message : 'UNKNOWN'));
    }
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const updates = reorderMailboxSiblings(mailboxes, String(active.id), String(over.id));
    if (updates.length === 0) return;
    try {
      await updateMailboxes(updates);
    } catch (error) {
      toast.error(mailboxErrorMessage(error instanceof Error ? error.message : 'UNKNOWN'));
    }
  };

  const confirmDelete = async () => {
    if (!deletingMailbox) return;
    try {
      await destroyMailbox({ id: deletingMailbox.id });
      setDeletingMailbox(null);
      toast.success(m['common.mailboxes.deleted']());
    } catch (error) {
      toast.error(mailboxErrorMessage(error instanceof Error ? error.message : 'UNKNOWN'));
    }
  };

  const editorOpen = editorKind !== null || editingMailbox !== null;
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{m['common.mailboxes.settingsTitle']()}</h1>
          <p className="text-muted-foreground text-sm">
            {m['common.mailboxes.settingsDescription']()}
          </p>
        </div>
        <Button onClick={() => setEditorKind(kind)}>
          <Plus className="mr-2 size-4" />
          {m['common.mailboxes.createItem']({
            kind:
              kind === 'folder' ? m['common.mailboxes.folder']() : m['common.mailboxes.label'](),
          })}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="folders">{m['common.navigation.folders']()}</TabsTrigger>
          <TabsTrigger value="labels">{m['common.navigation.labels']()}</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          {isLoading ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {m['common.actions.loading']()}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border py-8 text-center text-sm">
              {kind === 'folder'
                ? m['common.mailboxes.noFolders']()
                : m['common.mailboxes.noLabels']()}
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={rows.map(({ mailbox }) => mailbox.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="divide-y rounded-lg border">
                  {rows.map(({ mailbox, depth }) => (
                    <SortableMailboxRow
                      key={mailbox.id}
                      mailbox={mailbox}
                      depth={depth}
                      onEdit={() => setEditingMailbox(mailbox)}
                      onDelete={() => setDeletingMailbox(mailbox)}
                      onSubscribedChange={(checked) => toggleSubscribed(mailbox, checked)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </TabsContent>
      </Tabs>

      <MailboxEditorDialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditorKind(null);
            setEditingMailbox(null);
          }
        }}
        kind={
          editingMailbox?.kind === 'label'
            ? 'label'
            : editingMailbox?.kind === 'folder'
              ? 'folder'
              : (editorKind ?? kind)
        }
        mailbox={editingMailbox}
        mailboxes={mailboxes}
        onSubmit={saveMailbox}
      />
      <MailboxDeleteDialog
        mailbox={deletingMailbox}
        mailboxes={mailboxes}
        onOpenChange={(open) => {
          if (!open) setDeletingMailbox(null);
        }}
        onConfirm={confirmDelete}
        isPending={isPending}
      />
    </div>
  );
}

function SortableMailboxRow({
  mailbox,
  depth,
  onEdit,
  onDelete,
  onSubscribedChange,
}: {
  mailbox: Mailbox;
  depth: number;
  onEdit: () => void;
  onDelete: () => void;
  onSubscribedChange: (checked: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: mailbox.id,
  });
  return (
    <div
      ref={setNodeRef}
      className="bg-background flex items-center gap-3 p-3"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <button
        type="button"
        className="text-muted-foreground cursor-grab"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
        <span className="sr-only">{m['common.mailboxes.reorder']()}</span>
      </button>
      <div className="min-w-0 flex-1" style={{ paddingLeft: `${depth * 20}px` }}>
        <div className="flex items-center gap-2">
          {mailbox.kind === 'label' && mailbox.color ? (
            <span className="size-2.5 rounded-full" style={{ backgroundColor: mailbox.color }} />
          ) : null}
          <span className="truncate font-medium">{mailbox.name}</span>
        </div>
        <p className="text-muted-foreground text-xs">
          {m['common.mailboxes.threadStats']({
            total: mailbox.totalThreads.toLocaleString(),
            unread: mailbox.unreadThreads.toLocaleString(),
          })}
        </p>
      </div>
      <Switch
        checked={mailbox.isSubscribed}
        onCheckedChange={onSubscribedChange}
        aria-label={m['common.mailboxes.showInSidebar']()}
      />
      <Button variant="ghost" size="icon" asChild>
        <Link to={mailboxNodeHref(mailbox.id)}>
          <ExternalLink className="size-4" />
          <span className="sr-only">{m['common.mailboxes.open']()}</span>
        </Link>
      </Button>
      <Button variant="ghost" size="icon" onClick={onEdit}>
        <Pencil className="size-4" />
        <span className="sr-only">{m['common.mailboxes.edit']()}</span>
      </Button>
      <Button variant="ghost" size="icon" onClick={onDelete}>
        <Trash2 className="size-4" />
        <span className="sr-only">{m['common.mailboxes.delete']()}</span>
      </Button>
    </div>
  );
}
