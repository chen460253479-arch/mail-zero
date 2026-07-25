import { describe, expect, it } from 'vitest';

import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';
import type { MailAccountId } from '../../src';

describe('memory change repository', () => {
  it('returns all matching changes when no limit is provided', async () => {
    const deps = createMemoryMailCoreDependencies();
    const accountId = 'account-1' as MailAccountId;
    const change = {
      accountId,
      stateVersion: 1n,
      collection: 'email' as const,
      entityId: 'email-1',
      changeType: 'created' as const,
      changedProperties: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    await deps.unitOfWork.run((tx) => tx.changes.recordChange(change));

    const result = await deps.unitOfWork.run((tx) => tx.changes.queryChanges({ accountId }));

    expect(result).toEqual([change]);
  });

  it('treats limit as a soft boundary that includes the complete final state group', async () => {
    const deps = createMemoryMailCoreDependencies();
    const accountId = 'account-1' as MailAccountId;
    await deps.unitOfWork.run(async (tx) => {
      for (const [stateVersion, entityId] of [
        [1n, 'email-a'],
        [1n, 'email-b'],
        [2n, 'email-c'],
      ] as const) {
        await tx.changes.recordChange({
          accountId,
          stateVersion,
          collection: 'email',
          entityId,
          changeType: 'created',
          changedProperties: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        });
      }
    });

    const result = await deps.unitOfWork.run((tx) =>
      tx.changes.queryChanges({ accountId, limit: 1 }),
    );

    expect(result.map(({ entityId }) => entityId)).toEqual(['email-a', 'email-b']);
  });
});
