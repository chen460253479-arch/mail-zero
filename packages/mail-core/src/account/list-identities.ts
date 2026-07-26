import type { IdentityRecord, MailCoreDependencies } from '../store';
import { MailCoreError, type MailAccountId } from '../types';

export type ListIdentitiesInput = {
  accountId: MailAccountId;
};

export async function listIdentities(
  dependencies: Pick<MailCoreDependencies, 'unitOfWork'>,
  input: ListIdentitiesInput,
): Promise<IdentityRecord[]> {
  return dependencies.unitOfWork.run(async (tx) => {
    if ((await tx.accounts.findById(input.accountId)) === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    return tx.identities.listByAccount(input.accountId);
  });
}
