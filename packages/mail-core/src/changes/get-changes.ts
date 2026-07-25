import type { ChangeCollection, ChangeType, MailChange } from './types';
import { MailCoreError, type MailAccountId } from '../types';
import type { MailCoreDependencies } from '../store';

const MAX_CHANGES = 1000;

export type GetChangesInput = {
  accountId: MailAccountId;
  collection: ChangeCollection;
  sinceState: string;
  maxChanges: number;
};

export type ChangesResult = {
  oldState: string;
  newState: string;
  hasMoreChanges: boolean;
  created: string[];
  updated: string[];
  destroyed: string[];
};

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

const validateLimit = (limit: number): void => {
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_CHANGES) {
    throw new MailCoreError('INVALID_STATE');
  }
};

type EffectiveChange = {
  entityId: string;
  existedAtOldState: boolean;
  existsNow: boolean;
  firstState: bigint;
  firstOrder: number;
};

const collapseChanges = (
  records: MailChange[],
): Pick<ChangesResult, 'created' | 'updated' | 'destroyed'> => {
  const effective = new Map<string, EffectiveChange>();
  records.forEach((record, firstOrder) => {
    const existing = effective.get(record.entityId);
    if (existing === undefined) {
      effective.set(record.entityId, {
        entityId: record.entityId,
        existedAtOldState: record.changeType !== 'created',
        existsNow: record.changeType !== 'destroyed',
        firstState: record.stateVersion,
        firstOrder,
      });
      return;
    }
    existing.existsNow = record.changeType !== 'destroyed';
  });

  const ordered = [...effective.values()].sort((left, right) => {
    if (left.firstState !== right.firstState) {
      return left.firstState < right.firstState ? -1 : 1;
    }
    return left.firstOrder - right.firstOrder;
  });
  return {
    created: ordered
      .filter(({ existedAtOldState, existsNow }) => !existedAtOldState && existsNow)
      .map(({ entityId }) => entityId),
    updated: ordered
      .filter(({ existedAtOldState, existsNow }) => existedAtOldState && existsNow)
      .map(({ entityId }) => entityId),
    destroyed: ordered
      .filter(({ existedAtOldState, existsNow }) => existedAtOldState && !existsNow)
      .map(({ entityId }) => entityId),
  };
};

export async function getChanges(
  dependencies: Pick<MailCoreDependencies, 'unitOfWork'>,
  input: GetChangesInput,
): Promise<ChangesResult> {
  const sinceState = parseState(input.sinceState);
  validateLimit(input.maxChanges);

  return dependencies.unitOfWork.run(async (tx) => {
    const account = await tx.accounts.findById(input.accountId);
    if (account === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    const currentState = account.stateVersion;
    const oldestAvailableState = await tx.changes.oldestAvailableState(input.accountId);
    if (sinceState < oldestAvailableState || sinceState > currentState) {
      throw new MailCoreError('STATE_MISMATCH');
    }
    const consumed = await tx.changes.queryChanges({
      accountId: input.accountId,
      collection: input.collection,
      afterState: sinceState,
      throughState: currentState,
      limit: input.maxChanges,
    });
    const consumedState = consumed.at(-1)?.stateVersion;
    const hasMoreChanges =
      consumedState !== undefined &&
      (await tx.changes.hasChanges({
        accountId: input.accountId,
        collection: input.collection,
        afterState: consumedState,
        throughState: currentState,
      }));
    const newState = hasMoreChanges ? consumedState : currentState;
    return {
      oldState: input.sinceState,
      newState: newState.toString(),
      hasMoreChanges,
      ...collapseChanges(consumed),
    };
  });
}
