import { describe, expect, it } from 'vitest';

import type { InboundMailAdapter } from '../../../../../src/modules/mail-sync/domain/ingress-adapter';
import { renewInboundSubscription } from '../../../../../src/modules/mail-sync/application/renew-subscription';
import { MailSyncError } from '../../../../../src/modules/mail-sync/domain/errors';

describe('inbound subscription renewal', () => {
  it('renews from the persisted checkpoint without replacing it', async () => {
    const updates: unknown[] = [];
    const adapter: InboundMailAdapter = {
      provider: 'gmail',
      establishCheckpoint: async () => {
        throw new Error('must not establish a new baseline');
      },
      discover: async () => {
        throw new Error('unused');
      },
      fetchRawMessage: async () => {
        throw new Error('unused');
      },
      subscribe: async ({ checkpoint, target }) => {
        expect(checkpoint).toEqual({ version: 1, historyId: '250' });
        expect(target).toEqual({
          version: 1,
          topicName: 'projects/zero/topics/connection-1',
        });
        return { expiresAt: new Date('2026-08-10T00:00:00.000Z') };
      },
      classifyError: () => 'permanent',
    };

    const result = await renewInboundSubscription(
      {
        syncId: 'sync-1',
        owner: 'renew-worker',
        leaseForMs: 60_000,
        subscriptionTarget: {
          version: 1,
          topicName: 'projects/zero/topics/connection-1',
        },
      },
      {
        repository: {
          acquireSyncLease: async () => ({
            id: 'sync-1',
            accountId: 'account-1',
            provider: 'gmail',
            scope: {
              version: 1,
              mailboxRoles: ['inbox'],
              initialSync: 'none',
            },
            checkpoint: { version: 1, historyId: '250' },
          }),
          updateSubscription: async (input) => {
            updates.push(input);
          },
          pauseSync: async () => undefined,
          markAuthError: async () => undefined,
          releaseSyncLease: async () => undefined,
        },
        resolveConnectionId: async () => 'connection-1',
        getAdapterFactory: () => ({ create: async () => adapter }),
      },
    );

    expect(result).toEqual({ status: 'renewed' });
    expect(updates).toEqual([
      {
        syncId: 'sync-1',
        owner: 'renew-worker',
        subscriptionExpiresAt: new Date('2026-08-10T00:00:00.000Z'),
      },
    ]);
  });

  it.each([
    ['authentication', 'auth_error', 'markAuthError'],
    ['permanent', 'paused', 'pauseSync'],
  ] as const)(
    'moves the stream to %s state when renewal fails permanently',
    async (classification, expectedStatus, transition) => {
      const transitions: string[] = [];
      const adapter: InboundMailAdapter = {
        provider: 'gmail',
        establishCheckpoint: async () => {
          throw new Error('unused');
        },
        discover: async () => {
          throw new Error('unused');
        },
        fetchRawMessage: async () => {
          throw new Error('unused');
        },
        subscribe: async () => {
          throw new MailSyncError('GMAIL_RENEW_FAILED', classification);
        },
        classifyError: (error) =>
          error instanceof MailSyncError ? error.classification : 'retryable',
      };

      const result = await renewInboundSubscription(
        {
          syncId: 'sync-1',
          owner: 'renew-worker',
          leaseForMs: 60_000,
          subscriptionTarget: { version: 1, topicName: 'topic-1' },
        },
        {
          repository: {
            acquireSyncLease: async () => ({
              id: 'sync-1',
              accountId: 'account-1',
              provider: 'gmail',
              scope: {
                version: 1,
                mailboxRoles: ['inbox'],
                initialSync: 'none',
              },
              checkpoint: { version: 1, historyId: '250' },
            }),
            updateSubscription: async () => undefined,
            markAuthError: async () => {
              transitions.push('markAuthError');
            },
            pauseSync: async () => {
              transitions.push('pauseSync');
            },
            releaseSyncLease: async () => undefined,
          },
          resolveConnectionId: async () => 'connection-1',
          getAdapterFactory: () => ({ create: async () => adapter }),
        },
      );

      expect(result).toEqual({ status: expectedStatus });
      expect(transitions).toEqual([transition]);
    },
  );
});
