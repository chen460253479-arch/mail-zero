import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useTRPC } from '@/providers/query-provider';

import { useMailAccountContext } from '../providers/mail-account-provider';
import { adaptMailbox } from '../adapters/mailbox-adapter';

export function useMailboxes({ enabled = true }: { enabled?: boolean } = {}) {
  const trpc = useTRPC();
  const { account, status } = useMailAccountContext();
  const query = useQuery(
    trpc.mail.mailbox.get.queryOptions(
      { accountId: account?.id ?? '' },
      {
        enabled: enabled && status === 'ready' && Boolean(account),
        staleTime: 60_000,
      },
    ),
  );
  const mailboxes = useMemo(() => query.data?.list.map(adaptMailbox) ?? [], [query.data]);

  return {
    ...query,
    account,
    accountStatus: status,
    mailboxes,
    mailboxState: query.data?.state,
  };
}
