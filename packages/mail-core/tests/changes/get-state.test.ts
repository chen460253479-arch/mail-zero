import { describe, expect, it } from 'vitest';

import { createIdentity, createMailAccount, createMailCore } from '../../src';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';
import type { MailAccountId } from '../../src';

describe('collection state reads', () => {
  it('returns the account state as a canonical decimal string without mutation', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const core = createMailCore(dependencies);
    const account = await createMailAccount(dependencies, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    await createIdentity(dependencies, {
      accountId: account.id,
      name: 'Zero User',
      email: 'zero@example.test',
      replyTo: null,
      makeDefault: true,
    });
    const before = await dependencies.inspect.stateVersion(account.id);

    await expect(core.getState({ accountId: account.id, collection: 'email' })).resolves.toBe(
      before.toString(),
    );
    expect(await dependencies.inspect.stateVersion(account.id)).toBe(before);
  });

  it('rejects state reads for a missing account', async () => {
    const core = createMailCore(createMemoryMailCoreDependencies());

    await expect(
      core.getState({
        accountId: 'missing-account' as MailAccountId,
        collection: 'mailbox',
      }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
      details: { entityId: 'missing-account' },
    });
  });
});
