import { createMailCore, createMailAccount } from '@zero/mail-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryMailCoreDependencies } from '../../../../../../../packages/mail-core/src/testing/fakes';

const runtimeMocks = vi.hoisted(() => ({
  openAccessible: vi.fn(),
  openSession: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock('../../../../../src/modules/mail-api/runtime/create-mail-api', async (importOriginal) => ({
  ...(await importOriginal()),
  openAccessibleMailApiRuntime: runtimeMocks.openAccessible,
  openMailApiRuntime: runtimeMocks.openSession,
}));

import { identityRouter } from '../../../../../src/modules/mail-api/routers/identity';
import { mailboxRouter } from '../../../../../src/modules/mail-api/routers/mailbox';
import { accountRouter } from '../../../../../src/modules/mail-api/routers/account';
import { threadRouter } from '../../../../../src/modules/mail-api/routers/thread';
import { router } from '../../../../../src/trpc/trpc';

describe('Mail API resource Routers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns account-scoped DTOs without internal projection fields', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const account = await createMailAccount(dependencies, {
      userId: 'router-user',
      connectionId: 'router-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const otherAccount = await createMailAccount(dependencies, {
      userId: 'other-user',
      connectionId: 'other-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const core = createMailCore(dependencies);
    const runtime = {
      account,
      core,
      db: {},
      listAllAccounts: vi.fn(async () => [account, otherAccount]),
      close: runtimeMocks.close,
    };
    runtimeMocks.openAccessible.mockResolvedValue(runtime);
    runtimeMocks.openSession.mockResolvedValue(runtime);
    const caller = router({
      account: accountRouter,
      mailbox: mailboxRouter,
      thread: threadRouter,
      identity: identityRouter,
    }).createCaller({
      c: { env: {}, var: {} } as never,
      sessionUser: { id: 'router-user', role: 'user' } as never,
      authSession: { authMethod: 'password' } as never,
      auth: {} as never,
    });

    await expect(caller.account.list()).resolves.toMatchObject({
      accounts: [{ id: account.id, state: '1' }],
    });
    const mailboxes = await caller.mailbox.get({ accountId: account.id });
    expect(mailboxes).toMatchObject({
      accountId: account.id,
      state: '1',
      notFound: [],
    });
    expect(mailboxes.list).toHaveLength(8);
    expect(mailboxes.list[0]).not.toHaveProperty('normalizedName');
    await expect(caller.identity.get({ accountId: account.id })).resolves.toMatchObject({
      accountId: account.id,
      state: '1',
      list: [],
      notFound: [],
    });
    await expect(
      caller.thread.changes({
        accountId: account.id,
        sinceState: '0',
        maxChanges: 100,
      }),
    ).resolves.toMatchObject({
      oldState: '0',
      newState: '1',
      created: [],
      updated: [],
      destroyed: [],
    });
    expect(runtimeMocks.openAccessible).toHaveBeenCalledTimes(3);
    expect(runtimeMocks.close).toHaveBeenCalledTimes(4);

    const administrator = router({
      account: accountRouter,
    }).createCaller({
      c: { env: {}, var: {} } as never,
      sessionUser: { id: 'admin-user', role: 'admin' } as never,
      authSession: { authMethod: 'password' } as never,
      auth: {} as never,
    });

    await expect(administrator.account.list()).resolves.toMatchObject({
      accounts: [{ id: account.id }, { id: otherAccount.id }],
    });
    expect(runtime.listAllAccounts).toHaveBeenCalledOnce();
  });
});
