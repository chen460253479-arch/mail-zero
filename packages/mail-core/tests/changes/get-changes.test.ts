import { describe, expect, it } from 'vitest';

import {
  getChanges,
  MailCoreError,
  type ChangeCollection,
  type ChangeType,
  type MailAccountId,
} from '../../src';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';

const accountId = 'account-1' as MailAccountId;

const createHarness = async () => {
  const dependencies = createMemoryMailCoreDependencies();
  await dependencies.unitOfWork.run((tx) =>
    tx.accounts.insert({
      id: accountId,
      userId: 'user-1',
      connectionId: 'connection-1',
      stateVersion: 0n,
    }),
  );

  const record = async (
    stateVersion: bigint,
    entityId: string,
    changeType: ChangeType,
    collection: ChangeCollection = 'email',
  ) => {
    await dependencies.unitOfWork.run(async (tx) => {
      const allocated = await tx.nextStateVersion(accountId);
      expect(allocated).toBe(stateVersion);
      await tx.changes.recordChange({
        accountId,
        stateVersion,
        collection,
        entityId,
        changeType,
        changedProperties: null,
        createdAt: new Date(Number(stateVersion) * 1000),
      });
    });
  };

  const recordGroup = async (
    stateVersion: bigint,
    changes: Array<{ entityId: string; changeType: ChangeType; collection?: ChangeCollection }>,
  ) => {
    await dependencies.unitOfWork.run(async (tx) => {
      const allocated = await tx.nextStateVersion(accountId);
      expect(allocated).toBe(stateVersion);
      for (const change of changes) {
        await tx.changes.recordChange({
          accountId,
          stateVersion,
          collection: change.collection ?? 'email',
          entityId: change.entityId,
          changeType: change.changeType,
          changedProperties: null,
          createdAt: new Date(Number(stateVersion) * 1000),
        });
      }
    });
  };

  const advance = () =>
    dependencies.unitOfWork.run(async (tx) => {
      await tx.nextStateVersion(accountId);
    });

  return { dependencies, record, recordGroup, advance };
};

describe('getChanges', () => {
  it.each([
    ['created then updated', ['created', 'updated'], ['email-a'], [], []],
    ['created then destroyed', ['created', 'destroyed'], [], [], []],
    ['updated then destroyed', ['updated', 'destroyed'], [], [], ['email-a']],
    ['destroyed then created', ['destroyed', 'created'], [], ['email-a'], []],
  ] as const)(
    'collapses %s into one effective outcome',
    async (_label, sequence, created, updated, destroyed) => {
      const h = await createHarness();
      for (const [index, changeType] of sequence.entries()) {
        await h.record(BigInt(index + 1), 'email-a', changeType);
      }

      await expect(
        getChanges(h.dependencies, {
          accountId,
          collection: 'email',
          sinceState: '0',
          maxChanges: 20,
        }),
      ).resolves.toEqual({
        oldState: '0',
        newState: sequence.length.toString(),
        hasMoreChanges: false,
        created,
        updated,
        destroyed,
      });
    },
  );

  it('never splits one state group and reports the exact consumed boundary', async () => {
    const h = await createHarness();
    await h.recordGroup(1n, [
      { entityId: 'email-b', changeType: 'created' },
      { entityId: 'email-a', changeType: 'created' },
    ]);
    await h.record(2n, 'email-c', 'created');

    const first = await getChanges(h.dependencies, {
      accountId,
      collection: 'email',
      sinceState: '0',
      maxChanges: 1,
    });
    expect(first).toEqual({
      oldState: '0',
      newState: '1',
      hasMoreChanges: true,
      created: ['email-a', 'email-b'],
      updated: [],
      destroyed: [],
    });

    await expect(
      getChanges(h.dependencies, {
        accountId,
        collection: 'email',
        sinceState: first.newState,
        maxChanges: 1,
      }),
    ).resolves.toEqual({
      oldState: '1',
      newState: '2',
      hasMoreChanges: false,
      created: ['email-c'],
      updated: [],
      destroyed: [],
    });
  });

  it('uses bounded repository reads while preserving complete state groups', async () => {
    const h = await createHarness();
    await h.recordGroup(1n, [
      { entityId: 'email-a', changeType: 'created' },
      { entityId: 'email-b', changeType: 'created' },
    ]);
    await h.record(2n, 'email-c', 'created');

    await getChanges(h.dependencies, {
      accountId,
      collection: 'email',
      sinceState: '0',
      maxChanges: 1,
    });

    expect(await h.dependencies.inspect.changeQueries()).toEqual([
      expect.objectContaining({ limit: 1 }),
    ]);
  });

  it('advances an empty result to the consistent current state', async () => {
    const h = await createHarness();
    await h.advance();
    await h.advance();
    await h.record(3n, 'mailbox-a', 'created', 'mailbox');

    await expect(
      getChanges(h.dependencies, {
        accountId,
        collection: 'email',
        sinceState: '0',
        maxChanges: 10,
      }),
    ).resolves.toEqual({
      oldState: '0',
      newState: '3',
      hasMoreChanges: false,
      created: [],
      updated: [],
      destroyed: [],
    });
  });

  it.each(['', '-1', '+1', '01', '1.0', ' 1', '1 ', 'one'])(
    'rejects malformed noncanonical sinceState %j without mutation',
    async (sinceState) => {
      const h = await createHarness();
      const before = await h.dependencies.inspect.stateVersion(accountId);

      await expect(
        getChanges(h.dependencies, {
          accountId,
          collection: 'email',
          sinceState,
          maxChanges: 10,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_STATE', details: {} });
      expect(await h.dependencies.inspect.stateVersion(accountId)).toBe(before);
      expect(await h.dependencies.inspect.changes(accountId)).toEqual([]);
    },
  );

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    'rejects unbounded maxChanges %j',
    async (maxChanges) => {
      const h = await createHarness();

      await expect(
        getChanges(h.dependencies, {
          accountId,
          collection: 'email',
          sinceState: '0',
          maxChanges,
        }),
      ).rejects.toBeInstanceOf(MailCoreError);
    },
  );

  it('rejects a future state as STATE_MISMATCH without mutation', async () => {
    const h = await createHarness();

    await expect(
      getChanges(h.dependencies, {
        accountId,
        collection: 'email',
        sinceState: '1',
        maxChanges: 10,
      }),
    ).rejects.toMatchObject({ code: 'STATE_MISMATCH', details: {} });
    expect(await h.dependencies.inspect.stateVersion(accountId)).toBe(0n);
    expect(await h.dependencies.inspect.changes(accountId)).toEqual([]);
  });

  it('rejects a canonical state older than the retained account history', async () => {
    const h = await createHarness();
    await h.record(1n, 'email-a', 'created');
    await h.record(2n, 'email-a', 'updated');
    h.dependencies.unitOfWork.pruneChangesThrough(accountId, 1n);

    await expect(
      getChanges(h.dependencies, {
        accountId,
        collection: 'email',
        sinceState: '0',
        maxChanges: 10,
      }),
    ).rejects.toMatchObject({ code: 'STATE_MISMATCH', details: {} });
  });
});
