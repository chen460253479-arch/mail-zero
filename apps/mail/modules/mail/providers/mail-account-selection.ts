import type { MailAccount } from '../model/account';

export function selectMailAccount(
  accounts: readonly MailAccount[],
  activeConnectionId: string | null,
): MailAccount | null {
  if (!activeConnectionId) {
    return null;
  }

  return (
    accounts.find(
      (account) => account.connectionId === activeConnectionId && account.status === 'active',
    ) ?? null
  );
}
