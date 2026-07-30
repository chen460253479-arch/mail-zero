import type { MailAccountRecord, MailCore } from '@zero/mail-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  openAccessible: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock('../../../../../src/modules/mail-api/runtime/create-mail-api', async (importOriginal) => ({
  ...(await importOriginal()),
  openAccessibleMailApiRuntime: runtimeMocks.openAccessible,
}));

import { actionRouter } from '../../../../../src/modules/mail-api/routers/action';
import { router } from '../../../../../src/trpc/trpc';

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
    runtimeMocks.openAccessible.mockResolvedValue({
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
      sessionUser: { id: account.userId, role: 'user' } as never,
      authSession: { authMethod: 'password' } as never,
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
