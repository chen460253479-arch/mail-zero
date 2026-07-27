import { useMemo, type PropsWithChildren } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useActiveConnection } from '@/hooks/use-connections';
import { useTRPC } from '@/providers/query-provider';

import { MailAccountProvider } from '../providers/mail-account-provider';
import { adaptAccount } from '../adapters/account-adapter';

export function MailAccountBootstrapProvider({ children }: PropsWithChildren) {
  const trpc = useTRPC();
  const activeConnection = useActiveConnection();
  const accountsQuery = useQuery(trpc.mail.account.list.queryOptions());
  const accounts = useMemo(
    () => accountsQuery.data?.accounts.map(adaptAccount) ?? [],
    [accountsQuery.data],
  );

  return (
    <MailAccountProvider
      accounts={accounts}
      activeConnectionId={activeConnection.data?.id ?? null}
      isLoading={activeConnection.isLoading || accountsQuery.isLoading}
    >
      {children}
    </MailAccountProvider>
  );
}
