import { describe, expect, it } from 'vitest';

import { createIdentity, createMailAccount, setIdentities, type IdentityId } from '../../src';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';

const createHarness = async () => {
  const dependencies = createMemoryMailCoreDependencies();
  const account = await createMailAccount(dependencies, {
    userId: 'identity-set-user',
    connectionId: 'identity-set-connection',
    timezone: 'UTC',
    storageQuotaBytes: null,
  });
  const first = await createIdentity(dependencies, {
    accountId: account.id,
    name: 'First',
    email: 'first@example.test',
    replyTo: null,
    makeDefault: true,
  });
  const second = await createIdentity(dependencies, {
    accountId: account.id,
    name: 'Second',
    email: 'second@example.test',
    replyTo: null,
    makeDefault: false,
  });
  return { dependencies, account, first, second };
};

describe('setIdentities', () => {
  it('uses one state and reports a second default claim as an item conflict', async () => {
    const h = await createHarness();
    const before = await h.dependencies.inspect.stateVersion(h.account.id);

    const result = await setIdentities(h.dependencies, {
      accountId: h.account.id,
      ifInState: before.toString(),
      create: {
        created: {
          name: 'Created',
          email: 'created@example.test',
          replyTo: null,
          makeDefault: false,
        },
      },
      update: {
        [h.second.id]: { name: 'Second updated', makeDefault: true },
        [h.first.id]: { name: 'Conflicting default', makeDefault: true },
      },
      destroy: ['missing-identity' as IdentityId],
    });

    expect(result.created.created).toMatchObject({
      email: 'created@example.test',
      isDefault: false,
    });
    expect(result.updated[h.second.id]).toMatchObject({
      name: 'Second updated',
      isDefault: true,
    });
    expect(result.notUpdated[h.first.id]?.code).toBe('IDENTITY_DEFAULT_CONFLICT');
    expect(result.notDestroyed['missing-identity']?.code).toBe('IDENTITY_NOT_FOUND');
    expect(result.newState).toBe((before + 1n).toString());
    expect(await h.dependencies.inspect.stateVersion(h.account.id)).toBe(before + 1n);
  });

  it('rejects stale state before applying any item', async () => {
    const h = await createHarness();
    const before = await h.dependencies.inspect.stateVersion(h.account.id);

    await expect(
      setIdentities(h.dependencies, {
        accountId: h.account.id,
        ifInState: (before - 1n).toString(),
        create: {},
        update: { [h.first.id]: { name: 'Must not change' } },
        destroy: [],
      }),
    ).rejects.toMatchObject({ code: 'STATE_MISMATCH' });

    expect(await h.dependencies.inspect.stateVersion(h.account.id)).toBe(before);
    expect(await h.dependencies.inspect.identity(h.first.id)).toMatchObject({
      name: 'First',
    });
  });
});
