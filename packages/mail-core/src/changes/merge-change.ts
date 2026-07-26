import type { MailChange } from './types';

const mergeProperties = (left: string[] | null, right: string[] | null): string[] | null => {
  if (left === null || right === null) return null;
  return [...new Set([...left, ...right])].sort((a, b) => a.localeCompare(b));
};

export function mergeMailChanges(existing: MailChange, incoming: MailChange): MailChange {
  const sameKey =
    existing.accountId === incoming.accountId &&
    existing.stateVersion === incoming.stateVersion &&
    existing.collection === incoming.collection &&
    existing.entityId === incoming.entityId;
  if (!sameKey) {
    throw new Error('cannot merge Mail Changes with different identities');
  }
  const changeType =
    existing.changeType === 'destroyed' || incoming.changeType === 'destroyed'
      ? 'destroyed'
      : existing.changeType === 'created' || incoming.changeType === 'created'
        ? 'created'
        : 'updated';
  return {
    ...existing,
    changeType,
    changedProperties:
      changeType === 'updated'
        ? mergeProperties(existing.changedProperties, incoming.changedProperties)
        : null,
    createdAt:
      existing.createdAt.getTime() <= incoming.createdAt.getTime()
        ? existing.createdAt
        : incoming.createdAt,
  };
}
