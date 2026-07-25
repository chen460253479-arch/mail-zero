import type { ChangeCollection, ChangeType } from './types';
import type { MailTransaction } from '../store';
import type { MailAccountId } from '../types';

export type PendingMailChange = {
  collection: ChangeCollection;
  entityId: string;
  changeType: ChangeType;
  changedProperties: string[] | null;
};

export async function recordChanges(
  tx: MailTransaction,
  input: {
    accountId: MailAccountId;
    changes: PendingMailChange[];
    createdAt: Date;
  },
): Promise<bigint> {
  const stateVersion = await tx.nextStateVersion(input.accountId);
  for (const change of input.changes) {
    await tx.changes.recordChange({
      accountId: input.accountId,
      stateVersion,
      ...change,
      createdAt: input.createdAt,
    });
  }
  return stateVersion;
}
