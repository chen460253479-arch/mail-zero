import { MailCoreError, type MailAccountId } from '../types';
import type { MailTransaction } from '../store';

const parseState = (value: string): bigint => {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new MailCoreError('INVALID_STATE');
  }
  try {
    return BigInt(value);
  } catch {
    throw new MailCoreError('INVALID_STATE');
  }
};

export async function assertState(
  tx: MailTransaction,
  accountId: MailAccountId,
  ifInState: string | undefined,
): Promise<string> {
  const account = await tx.accounts.findById(accountId);
  if (account === null) {
    throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: accountId });
  }
  if (ifInState !== undefined && parseState(ifInState) !== account.stateVersion) {
    throw new MailCoreError('STATE_MISMATCH');
  }
  return account.stateVersion.toString();
}
