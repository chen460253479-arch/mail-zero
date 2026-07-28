import type { MailAccountRecord, MailCore } from '@zero/mail-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  openOwned: vi.fn(),
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

vi.mock('../../../../../src/modules/mail-api/runtime/create-mail-api', async (importOriginal) => ({
  ...(await importOriginal()),
  openOwnedMailApiRuntime: runtimeMocks.openOwned,
}));

import { router } from '../../../../../src/trpc/trpc';
import { actionRouter } from '../../../../../src/modules/mail-api/routers/action';

describe('Action Router', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes Thread mutations only through Mail Core and preserves the client mutation ID', async () => {
    const account = {
      id: 'account-action',
      userId: 'action-user',
      status: 'active',
    } as MailAccountRecord;
    const updateThreadEmails = vi.fn(async () => ({
      oldState: '4',
      newState: '5',
      updatedThreadIds: ['thread-1'],
      failed: {},
    }));
    runtimeMocks.openOwned.mockResolvedValue({
      account,
      core: { updateThreadEmails } as unknown as MailCore,
      outbound: {},
      snooze: {
        snooze: vi.fn(),
        unsnooze: vi.fn(),
      },
      db: {},
      close: runtimeMocks.close,
    });
    const caller = router({ action: actionRouter }).createCaller({
      c: { env: {}, var: {} } as never,
      sessionUser: { id: account.userId } as never,
      auth: {} as never,
    });

    const result = await caller.action.updateThreads({
      accountId: account.id,
      threadIds: ['thread-1'],
      addKeywords: ['$seen'],
      clientMutationId: 'mutation-1',
    });

    expect(updateThreadEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: account.id,
        threadIds: ['thread-1'],
        addKeywords: ['$seen'],
      }),
    );
    expect(result).toMatchObject({
      clientMutationId: 'mutation-1',
      updatedThreadIds: ['thread-1'],
    });
    expect(runtimeMocks.close).toHaveBeenCalledOnce();
  });
});
