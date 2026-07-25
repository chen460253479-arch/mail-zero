import type { MailboxRecord, MailCoreDependencies } from '../store';
import type { ListMailboxesInput } from './types';
import { MailCoreError } from '../types';

export async function listMailboxes(
  dependencies: MailCoreDependencies,
  input: ListMailboxesInput,
): Promise<MailboxRecord[]> {
  return dependencies.unitOfWork.run(async (tx) => {
    if ((await tx.accounts.findById(input.accountId)) === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    return (await tx.mailboxes.listByAccount(input.accountId))
      .filter(({ deletedAt }) => deletedAt === null)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  });
}
