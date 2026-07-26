import type { MailCoreDependencies } from '../store';
import type { MailAccountId } from '../types';

export type MailAggregateEntityType = 'thread' | 'mailbox' | 'mailbox_thread';
export type MailAggregateValues = Record<string, boolean | number | string | null>;

export type AggregateMismatch = {
  entityType: MailAggregateEntityType;
  entityId: string;
  expected: MailAggregateValues;
  actual: MailAggregateValues | null;
};

export type ReconcileMailAggregatesInput = {
  accountId: MailAccountId;
  repair: boolean;
};

export type ReconcileMailAggregatesResult = {
  mismatches: AggregateMismatch[];
  repaired: boolean;
};

export async function reconcileMailAggregates(
  dependencies: MailCoreDependencies,
  input: ReconcileMailAggregatesInput,
): Promise<ReconcileMailAggregatesResult> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    return tx.mailAggregateMaintenance.reconcile({
      ...input,
      now: dependencies.clock.now(),
    });
  });
}
