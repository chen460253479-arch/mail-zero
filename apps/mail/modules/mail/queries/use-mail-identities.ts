import { skipToken, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useTRPC } from '@/providers/query-provider';

import { useMailAccountContext } from '../providers/mail-account-provider';
import { adaptIdentity } from '../adapters/identity-adapter';

export function useMailIdentities() {
  const trpc = useTRPC();
  const { account, status } = useMailAccountContext();
  const canQuery = status === 'ready' && Boolean(account);
  const query = useQuery(
    trpc.mail.identity.get.queryOptions(canQuery ? { accountId: account!.id } : skipToken, {
      enabled: canQuery,
      staleTime: 5 * 60_000,
    }),
  );
  const identities = useMemo(() => query.data?.list.map(adaptIdentity) ?? [], [query.data?.list]);
  const guardedQuery = canQuery
    ? query
    : {
        ...query,
        refetch: async () => query,
      };

  return {
    ...guardedQuery,
    account,
    identities,
    identityState: query.data?.state,
  };
}
