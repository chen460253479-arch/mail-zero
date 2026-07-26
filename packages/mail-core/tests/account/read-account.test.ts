import { describe, expect, it } from 'vitest';

import { createIdentity, createMailAccount, createMailCore } from '../../src';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';
import type { MailAccountId } from '../../src';

describe('MailAccount reads', () => {
  it('lists only accounts owned by the requested user in stable creation order', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const core = createMailCore(dependencies);
    const first = await createMailAccount(dependencies, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    await createMailAccount(dependencies, {
      userId: 'user-2',
      connectionId: 'connection-2',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const second = await createMailAccount(dependencies, {
      userId: 'user-1',
      connectionId: 'connection-3',
      timezone: 'Asia/Shanghai',
      storageQuotaBytes: 1024n,
    });

    await expect(core.listAccounts({ userId: 'user-1' })).resolves.toEqual([first, second]);
  });

  it('gets an account and rejects a missing account with the stable domain error', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const core = createMailCore(dependencies);
    const account = await createMailAccount(dependencies, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });

    await expect(core.getAccount({ accountId: account.id })).resolves.toEqual(account);
    await expect(
      core.getAccount({ accountId: 'missing-account' as MailAccountId }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
      details: { entityId: 'missing-account' },
    });
  });

  it('lists identities only after validating that the account exists', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const core = createMailCore(dependencies);
    const account = await createMailAccount(dependencies, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const identity = await createIdentity(dependencies, {
      accountId: account.id,
      name: 'Zero User',
      email: 'zero@example.test',
      replyTo: null,
      makeDefault: true,
    });

    await expect(core.listIdentities({ accountId: account.id })).resolves.toEqual([identity]);
    await expect(
      core.listIdentities({ accountId: 'missing-account' as MailAccountId }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
      details: { entityId: 'missing-account' },
    });
  });
});
