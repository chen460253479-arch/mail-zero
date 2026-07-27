import { describe, expect, it, vi } from 'vitest';

import { createDestroyThreadsService } from './thread-action-service';

describe('destroy threads service', () => {
  it('resolves local thread email ids and destroys them in one Email/set operation', async () => {
    const core = {
      getThread: vi
        .fn()
        .mockResolvedValueOnce({ id: 'thread-1', emailIds: ['email-1', 'email-2'] })
        .mockResolvedValueOnce({ id: 'thread-2', emailIds: ['email-3'] }),
      setEmails: vi.fn(async () => ({
        oldState: 's1',
        newState: 's2',
        created: {},
        updated: {},
        destroyed: ['email-1', 'email-2', 'email-3'],
        notCreated: {},
        notUpdated: {},
        notDestroyed: {},
      })),
    };

    await expect(
      createDestroyThreadsService(core as never).destroyThreads({
        accountId: 'account-1',
        threadIds: ['thread-1', 'thread-2'],
        ifInState: 's1',
        clientMutationId: 'mutation-1',
      }),
    ).resolves.toMatchObject({
      accountId: 'account-1',
      oldState: 's1',
      newState: 's2',
      destroyedThreadIds: ['thread-1', 'thread-2'],
      failed: {},
    });

    expect(core.setEmails).toHaveBeenCalledWith({
      accountId: 'account-1',
      ifInState: 's1',
      create: {},
      update: {},
      destroy: ['email-1', 'email-2', 'email-3'],
    });
  });
});
