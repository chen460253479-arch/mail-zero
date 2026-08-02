import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';

import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
} from '@/components/ui/sidebar';
import type { Mailbox } from '@/modules/mail/model/mailbox';
import { useMailboxes } from '@/modules/mail/queries/use-mailboxes';
import { resolveActiveMailboxId } from '@/modules/mail/routing/mailbox-route';
import { buildMailboxTree } from '@/modules/mail/selectors/mailbox-tree';
import { m } from '@/paraglide/messages';

import { FolderTree } from './folder-tree';

export function createMailboxSidebarModel(mailboxes: readonly Mailbox[]) {
  return {
    folders: buildMailboxTree(mailboxes, { kind: 'folder', subscribedOnly: true }),
    labels: buildMailboxTree(mailboxes, { kind: 'label', subscribedOnly: true }),
  };
}

const expandedStorageKey = (accountId: string) => `zero:mailbox-expanded:${accountId}`;

const loadExpandedIds = (accountId: string | undefined): Set<string> => {
  if (!accountId || typeof window === 'undefined') return new Set();
  try {
    const value = JSON.parse(window.localStorage.getItem(expandedStorageKey(accountId)) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
};

export function MailboxSidebar() {
  const { account, mailboxes } = useMailboxes();
  const location = useLocation();
  const model = useMemo(() => createMailboxSidebarModel(mailboxes), [mailboxes]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => loadExpandedIds(account?.id));
  const activeMailboxId = resolveActiveMailboxId(location.pathname, mailboxes);

  useEffect(() => {
    setExpandedIds(loadExpandedIds(account?.id));
  }, [account?.id]);

  useEffect(() => {
    if (!account || typeof window === 'undefined') return;
    window.localStorage.setItem(expandedStorageKey(account.id), JSON.stringify([...expandedIds]));
  }, [account, expandedIds]);

  const toggle = (mailboxId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(mailboxId)) next.delete(mailboxId);
      else next.add(mailboxId);
      return next;
    });
  };

  return (
    <>
      <MailboxTreeSection
        title={m['common.navigation.folders']()}
        createHref="/settings/mailboxes?tab=folders&create=true"
        nodes={model.folders}
        activeMailboxId={activeMailboxId}
        expandedIds={expandedIds}
        onToggle={toggle}
      />
      <MailboxTreeSection
        title={m['common.navigation.labels']()}
        createHref="/settings/mailboxes?tab=labels&create=true"
        nodes={model.labels}
        activeMailboxId={activeMailboxId}
        expandedIds={expandedIds}
        onToggle={toggle}
      />
    </>
  );
}

function MailboxTreeSection({
  title,
  createHref,
  nodes,
  activeMailboxId,
  expandedIds,
  onToggle,
}: {
  title: string;
  createHref: string;
  nodes: ReturnType<typeof buildMailboxTree>;
  activeMailboxId: string | null;
  expandedIds: ReadonlySet<string>;
  onToggle: (mailboxId: string) => void;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarGroupAction asChild title={`创建${title}`}>
        <Link to={createHref}>
          <Plus />
          <span className="sr-only">创建{title}</span>
        </Link>
      </SidebarGroupAction>
      <SidebarGroupContent>
        <FolderTree
          nodes={nodes}
          activeMailboxId={activeMailboxId}
          expandedIds={expandedIds}
          onToggle={onToggle}
        />
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
