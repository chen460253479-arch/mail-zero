import { ChevronRight, Folder as FolderIcon, Tag } from 'lucide-react';
import { Link } from 'react-router';

import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from '@/components/ui/sidebar';
import { mailboxBadgeCount } from '@/modules/mail/selectors/mailbox-count';
import type { MailboxTreeNode } from '@/modules/mail/model/mailbox';
import { useSidebar } from '@/components/context/sidebar-context';
import { m } from '@/paraglide/messages';
import { cn } from '@/lib/utils';

export const mailboxNodeHref = (mailboxId: string) => `/mail/${encodeURIComponent(mailboxId)}`;

export type MailboxTreeNodeProps = {
  node: MailboxTreeNode;
  activeMailboxId: string | null;
  expandedIds: ReadonlySet<string>;
  onToggle: (mailboxId: string) => void;
};

export function MailboxTreeNodeItem({
  node,
  activeMailboxId,
  expandedIds,
  onToggle,
}: MailboxTreeNodeProps) {
  const { setOpenMobile } = useSidebar();
  const hasChildren = node.children.length > 0;
  const expanded = expandedIds.has(node.id);
  const count = mailboxBadgeCount(node);
  const Icon = node.kind === 'folder' ? FolderIcon : Tag;

  return (
    <SidebarMenuItem>
      <div className="flex min-w-0 items-center">
        {hasChildren ? (
          <button
            type="button"
            aria-label={
              expanded
                ? m['common.mailboxes.collapseItem']({ name: node.name })
                : m['common.mailboxes.expandItem']({ name: node.name })
            }
            aria-expanded={expanded}
            className="text-muted-foreground flex size-6 shrink-0 items-center justify-center"
            onClick={() => onToggle(node.id)}
          >
            <ChevronRight className={cn('size-3 transition-transform', expanded && 'rotate-90')} />
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        )}
        <SidebarMenuButton asChild isActive={activeMailboxId === node.id} className="min-w-0">
          <Link to={mailboxNodeHref(node.id)} onClick={() => setOpenMobile(false)}>
            <Icon
              className="size-4 shrink-0"
              style={node.color ? { color: node.color } : undefined}
            />
            <span className="truncate">{node.name}</span>
          </Link>
        </SidebarMenuButton>
        {count !== null ? <SidebarMenuBadge>{count.toLocaleString()}</SidebarMenuBadge> : null}
      </div>
      {hasChildren && expanded ? (
        <SidebarMenuSub>
          {node.children.map((child) => (
            <MailboxTreeNodeItem
              key={child.id}
              node={child}
              activeMailboxId={activeMailboxId}
              expandedIds={expandedIds}
              onToggle={onToggle}
            />
          ))}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}
