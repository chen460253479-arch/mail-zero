import { skipToken, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useTRPC } from '@/providers/query-provider';

import { useMailAccountContext } from '../providers/mail-account-provider';
import { adaptMailbox } from '../adapters/mailbox-adapter';

export function useMailboxes({ enabled = true }: { enabled?: boolean } = {}) {
  const trpc = useTRPC();
  const { account, status } = useMailAccountContext();
  const canQuery = enabled && status === 'ready' && Boolean(account);
  const query = useQuery(
    trpc.mail.mailbox.get.queryOptions(canQuery ? { accountId: account!.id } : skipToken, {
      enabled: canQuery,
      staleTime: 60_000,
    }),
  );
  const mailboxes = useMemo(() => query.data?.list.map(adaptMailbox) ?? [], [query.data]);
  const guardedQuery = canQuery
    ? query
    : {
        ...query,
        refetch: async () => query,
      };

  return {
    ...guardedQuery,
    account,
    accountStatus: status,
    mailboxes,
    mailboxState: query.data?.state,
  };
}
