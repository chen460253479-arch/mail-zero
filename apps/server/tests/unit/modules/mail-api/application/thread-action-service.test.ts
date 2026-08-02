import { describe, expect, it } from 'vitest';

import type { MoveThreadEmailsResult, ThreadId } from '@zero/mail-core';

import { createThreadActionService } from '../../../../../src/modules/mail-api/application/thread-action-service';

describe('thread action service', () => {
  it('maps the semantic move request and preserves item failures and client mutation identity', async () => {
    const calls: unknown[] = [];
    const service = createThreadActionService({
      updateThreadEmails: async () => ({
        oldState: '0',
        newState: '0',
        updatedThreadIds: [],
        failed: {},
      }),
      moveThreadEmails: async (input): Promise<MoveThreadEmailsResult> => {
        calls.push(input);
        return {
          oldState: '12',
          newState: '13',
          movedThreadIds: ['thread-1' as ThreadId],
          failed: {
            'thread-missing': {
              code: 'THREAD_NOT_FOUND',
              details: { entityId: 'thread-missing' },
            },
          },
        };
      },
      restoreArchivedThreadEmails: async (): Promise<MoveThreadEmailsResult> => ({
        oldState: '13',
        newState: '14',
        movedThreadIds: [],
        failed: {},
      }),
    });

    await expect(
      service.moveThreads({
        accountId: 'account-1',
        threadIds: ['thread-1', 'thread-missing'],
        sourceMailboxId: 'mailbox-sent',
        destinationMailboxId: 'folder-1',
        ifInState: '12',
        clientMutationId: 'mutation-1',
      }),
    ).resolves.toEqual({
      accountId: 'account-1',
      clientMutationId: 'mutation-1',
      oldState: '12',
      newState: '13',
      movedThreadIds: ['thread-1'],
      failed: {
        'thread-missing': {
          code: 'NOT_FOUND',
          details: { entityId: 'thread-missing' },
        },
      },
    });
    expect(calls).toEqual([
      {
        accountId: 'account-1',
        threadIds: ['thread-1', 'thread-missing'],
        sourceMailboxId: 'mailbox-sent',
        destinationMailboxId: 'folder-1',
        ifInState: '12',
      },
    ]);
  });

  it('routes archive restoration through lifecycle-aware core semantics', async () => {
    const calls: unknown[] = [];
    const service = createThreadActionService({
      updateThreadEmails: async () => ({
        oldState: '0',
        newState: '0',
        updatedThreadIds: [],
        failed: {},
      }),
      moveThreadEmails: async (): Promise<MoveThreadEmailsResult> => ({
        oldState: '0',
        newState: '0',
        movedThreadIds: [],
        failed: {},
      }),
      restoreArchivedThreadEmails: async (input): Promise<MoveThreadEmailsResult> => {
        calls.push(input);
        return {
          oldState: '14',
          newState: '15',
          movedThreadIds: ['thread-1' as ThreadId],
          failed: {},
        };
      },
    });

    await expect(
      service.restoreArchivedThreads({
        accountId: 'account-1',
        threadIds: ['thread-1'],
        ifInState: '14',
        clientMutationId: 'mutation-2',
      }),
    ).resolves.toMatchObject({ movedThreadIds: ['thread-1'], failed: {} });
    expect(calls).toEqual([{ accountId: 'account-1', threadIds: ['thread-1'], ifInState: '14' }]);
  });
});
