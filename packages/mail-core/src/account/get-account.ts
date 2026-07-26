import type { MailAccountRecord, MailCoreDependencies } from '../store';
import { MailCoreError, type MailAccountId } from '../types';

export type ListMailAccountsInput = {
  userId: string;
};

export type GetMailAccountInput = {
  accountId: MailAccountId;
};

export async function listMailAccounts(
  dependencies: Pick<MailCoreDependencies, 'unitOfWork'>,
  input: ListMailAccountsInput,
): Promise<MailAccountRecord[]> {
  return dependencies.unitOfWork.run((tx) => tx.accounts.listByUser(input.userId));
}

export async function getMailAccount(
  dependencies: Pick<MailCoreDependencies, 'unitOfWork'>,
  input: GetMailAccountInput,
): Promise<MailAccountRecord> {
  return dependencies.unitOfWork.run(async (tx) => {
    const account = await tx.accounts.findById(input.accountId);
    if (account === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    return account;
  });
}
