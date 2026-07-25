import { describe, expect, it } from 'vitest';

import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';
import type { AccountRepository, MailAccountId } from '../../src';

const accountId = 'account-1' as MailAccountId;
type AccountUpdatePatch = Parameters<AccountRepository['update']>[1];

// @ts-expect-error State versions must be allocated through nextStateVersion().
const directStateVersionPatch: AccountUpdatePatch = { stateVersion: 99n };
void directStateVersionPatch;

describe('memory mail unit of work', () => {
  it('rolls back writes when the operation throws', async () => {
    const deps = createMemoryMailCoreDependencies();
    await expect(
      deps.unitOfWork.run(async (tx) => {
        await tx.accounts.insert({
          id: accountId,
          userId: 'user-1',
          connectionId: 'connection-1',
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await expect(deps.inspect.accounts()).resolves.toEqual([]);
  });

  it('allocates one state version per transaction', async () => {
    const deps = createMemoryMailCoreDependencies();
    const versions = await deps.unitOfWork.run(async (tx) => {
      await tx.accounts.insert({
        id: accountId,
        userId: 'user-1',
        connectionId: 'connection-1',
      });
      return [
        await tx.nextStateVersion(accountId),
        await tx.nextStateVersion(accountId),
      ];
    });
    expect(versions).toEqual([1n, 1n]);

    const nextVersion = await deps.unitOfWork.run((tx) =>
      tx.nextStateVersion(accountId),
    );
    expect(nextVersion).toBe(2n);
  });

  it('serializes overlapping transactions so state versions remain monotonic', async () => {
    const deps = createMemoryMailCoreDependencies();
    await deps.unitOfWork.run(async (tx) => {
      await tx.accounts.insert({
        id: accountId,
        userId: 'user-1',
        connectionId: 'connection-1',
      });
    });

    let releaseFirst: () => void = () => undefined;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstHasVersion: () => void = () => undefined;
    const firstAllocated = new Promise<void>((resolve) => {
      firstHasVersion = resolve;
    });
    const first = deps.unitOfWork.run(async (tx) => {
      const version = await tx.nextStateVersion(accountId);
      firstHasVersion();
      await firstMayFinish;
      return version;
    });
    await firstAllocated;
    const second = deps.unitOfWork.run((tx) => tx.nextStateVersion(accountId));
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual([1n, 2n]);
  });
});
