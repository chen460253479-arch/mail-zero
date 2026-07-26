import { MailCoreError, type MailAccountId } from '../types';
import type { MailCoreDependencies } from '../store';
import type { ChangeCollection } from './types';

export type GetStateInput = {
  accountId: MailAccountId;
  collection: ChangeCollection;
};

export async function getState(
  dependencies: Pick<MailCoreDependencies, 'unitOfWork'>,
  input: GetStateInput,
): Promise<string> {
  return dependencies.unitOfWork.run(async (tx) => {
    const account = await tx.accounts.findById(input.accountId);
    if (account === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    return account.stateVersion.toString();
  });
}
