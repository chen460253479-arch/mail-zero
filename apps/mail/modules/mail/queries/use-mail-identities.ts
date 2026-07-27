import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useTRPC } from '@/providers/query-provider';

import { useMailAccountContext } from '../providers/mail-account-provider';
import { adaptIdentity } from '../adapters/identity-adapter';

export function useMailIdentities() {
  const trpc = useTRPC();
  const { account, status } = useMailAccountContext();
  const query = useQuery(
    trpc.mail.identity.get.queryOptions(
      { accountId: account?.id ?? '' },
      {
        enabled: status === 'ready' && Boolean(account),
        staleTime: 5 * 60_000,
      },
    ),
  );
  const identities = useMemo(() => query.data?.list.map(adaptIdentity) ?? [], [query.data?.list]);

  return {
    ...query,
    account,
    identities,
    identityState: query.data?.state,
  };
}
