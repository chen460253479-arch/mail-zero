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
import { CSS } from '@dnd-kit/utilities';
import { ExternalLink, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CustomMailboxKind, Mailbox, MailboxTreeNode } from '@/modules/mail/model/mailbox';
import { mailboxErrorMessage } from '@/modules/mail/mutations/mailbox-error-message';
import { useMailboxActions } from '@/modules/mail/mutations/use-mailbox-actions';
import { useMailboxes } from '@/modules/mail/queries/use-mailboxes';
import { buildMailboxTree } from '@/modules/mail/selectors/mailbox-tree';

import { MailboxDeleteDialog } from './mailbox-delete-dialog';
import { MailboxEditorDialog, type MailboxEditorValue } from './mailbox-editor-dialog';
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
  nodes.flatMap((node) => [
    { mailbox: node, depth },
    ...flattenTree(node.children, depth + 1),
  ]);

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
  const rows = useMemo(
    () => flattenTree(buildMailboxTree(mailboxes, { kind })),
    [kind, mailboxes],
  );

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
      toast.success('邮箱项目已保存');
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
      toast.success('邮箱项目已删除');
    } catch (error) {
      toast.error(mailboxErrorMessage(error instanceof Error ? error.message : 'UNKNOWN'));
    }
  };

  const editorOpen = editorKind !== null || editingMailbox !== null;
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">文件夹与标签</h1>
          <p className="text-muted-foreground text-sm">
            管理本地邮件的主要文件夹和可多选标签，不会反向同步到邮件服务商。
          </p>
        </div>
        <Button onClick={() => setEditorKind(kind)}>
          <Plus className="mr-2 size-4" />
          创建{kind === 'folder' ? '文件夹' : '标签'}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="folders">文件夹</TabsTrigger>
          <TabsTrigger value="labels">标签</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          {isLoading ? (
            <p className="text-muted-foreground py-8 text-center text-sm">正在加载…</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border py-8 text-center text-sm">
              暂无{kind === 'folder' ? '文件夹' : '标签'}
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={rows.map(({ mailbox }) => mailbox.id)} strategy={verticalListSortingStrategy}>
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
        kind={editingMailbox?.kind === 'label' ? 'label' : editingMailbox?.kind === 'folder' ? 'folder' : editorKind ?? kind}
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
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
    >
      <button type="button" className="text-muted-foreground cursor-grab" {...attributes} {...listeners}>
        <GripVertical className="size-4" />
        <span className="sr-only">调整顺序</span>
      </button>
      <div className="min-w-0 flex-1" style={{ paddingLeft: `${depth * 20}px` }}>
        <div className="flex items-center gap-2">
          {mailbox.kind === 'label' && mailbox.color ? (
            <span className="size-2.5 rounded-full" style={{ backgroundColor: mailbox.color }} />
          ) : null}
          <span className="truncate font-medium">{mailbox.name}</span>
        </div>
        <p className="text-muted-foreground text-xs">
          {mailbox.totalThreads.toLocaleString()} 个会话 · {mailbox.unreadThreads.toLocaleString()} 个未读
        </p>
      </div>
      <Switch
        checked={mailbox.isSubscribed}
        onCheckedChange={onSubscribedChange}
        aria-label="在侧边栏显示"
      />
      <Button variant="ghost" size="icon" asChild>
        <Link to={mailboxNodeHref(mailbox.id)}>
          <ExternalLink className="size-4" />
          <span className="sr-only">打开</span>
        </Link>
      </Button>
      <Button variant="ghost" size="icon" onClick={onEdit}>
        <Pencil className="size-4" />
        <span className="sr-only">编辑</span>
      </Button>
      <Button variant="ghost" size="icon" onClick={onDelete}>
        <Trash2 className="size-4" />
        <span className="sr-only">删除</span>
      </Button>
    </div>
  );
}
