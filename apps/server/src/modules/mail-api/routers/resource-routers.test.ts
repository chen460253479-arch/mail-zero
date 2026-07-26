import { createMailCore, createMailAccount } from '@zero/mail-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryMailCoreDependencies } from '../../../../../../packages/mail-core/src/testing/fakes';

const runtimeMocks = vi.hoisted(() => ({
  openOwned: vi.fn(),
  openSession: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock('cloudflare:workers', () => {
  class RuntimeBase {}
  return {
    env: {},
    DurableObject: RuntimeBase,
    RpcTarget: RuntimeBase,
    WorkerEntrypoint: RuntimeBase,
    WorkflowEntrypoint: RuntimeBase,
  };
});

vi.mock('../runtime/create-mail-api', async (importOriginal) => ({
  ...(await importOriginal()),
  openOwnedMailApiRuntime: runtimeMocks.openOwned,
  openMailApiRuntime: runtimeMocks.openSession,
}));

import { router } from '../../../trpc/trpc';
import { identityRouter } from './identity';
import { mailboxRouter } from './mailbox';
import { accountRouter } from './account';
import { threadRouter } from './thread';

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
    const core = createMailCore(dependencies);
    const runtime = {
      account,
      core,
      db: {},
      close: runtimeMocks.close,
    };
    runtimeMocks.openOwned.mockResolvedValue(runtime);
    runtimeMocks.openSession.mockResolvedValue(runtime);
    const caller = router({
      account: accountRouter,
      mailbox: mailboxRouter,
      thread: threadRouter,
      identity: identityRouter,
    }).createCaller({
      c: { env: {}, var: {} } as never,
      sessionUser: { id: 'router-user' } as never,
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
    expect(runtimeMocks.openOwned).toHaveBeenCalledTimes(3);
    expect(runtimeMocks.close).toHaveBeenCalledTimes(4);
  });
});
