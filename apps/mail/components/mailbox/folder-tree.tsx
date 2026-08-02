import { SidebarMenu } from '@/components/ui/sidebar';
import type { MailboxTreeNode } from '@/modules/mail/model/mailbox';

import { MailboxTreeNodeItem } from './mailbox-tree-node';

export type FolderTreeProps = {
  nodes: readonly MailboxTreeNode[];
  activeMailboxId: string | null;
  expandedIds: ReadonlySet<string>;
  onToggle: (mailboxId: string) => void;
};

export function FolderTree({ nodes, activeMailboxId, expandedIds, onToggle }: FolderTreeProps) {
  return (
    <SidebarMenu>
      {nodes.map((node) => (
        <MailboxTreeNodeItem
          key={node.id}
          node={node}
          activeMailboxId={activeMailboxId}
          expandedIds={expandedIds}
          onToggle={onToggle}
        />
      ))}
    </SidebarMenu>
  );
}
