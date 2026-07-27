import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';

import { selectMailAccount } from './mail-account-selection';
import type { MailAccount } from '../model/account';

export type MailAccountContextValue = {
  account: MailAccount | null;
  status: 'loading' | 'no-connection' | 'unavailable' | 'ready';
};

const MailAccountContext = createContext<MailAccountContextValue | null>(null);

export function MailAccountProvider({
  accounts,
  activeConnectionId,
  isLoading,
  children,
}: PropsWithChildren<{
  accounts: readonly MailAccount[];
  activeConnectionId: string | null;
  isLoading: boolean;
}>) {
  const value = useMemo<MailAccountContextValue>(() => {
    if (isLoading) {
      return { account: null, status: 'loading' };
    }

    if (!activeConnectionId) {
      return { account: null, status: 'no-connection' };
    }

    const account = selectMailAccount(accounts, activeConnectionId);
    return account ? { account, status: 'ready' } : { account: null, status: 'unavailable' };
  }, [accounts, activeConnectionId, isLoading]);

  return <MailAccountContext.Provider value={value}>{children}</MailAccountContext.Provider>;
}

export function useMailAccountContext(): MailAccountContextValue {
  const value = useContext(MailAccountContext);
  if (!value) {
    throw new Error('useMailAccountContext must be used inside MailAccountProvider');
  }
  return value;
}
