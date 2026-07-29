import { describe, expect, it } from 'vitest';

import type {
  InboundMailAdapter,
  InboundMailAdapterFactory,
  IngressScope,
} from '../../../../../src/modules/mail-sync/domain/ingress-adapter';
import { bootstrapLocalMailAccount } from '../../../../../src/modules/mail-sync/application/bootstrap-account';
import { activateInboundSync } from '../../../../../src/modules/mail-sync/application/activate';

const scope: IngressScope = {
  version: 1,
  mailboxRoles: ['inbox'],
  initialSync: 'none',
};

describe('local mail account bootstrap', () => {
  it('returns an existing account without creating another one', async () => {
    let createCalls = 0;
    const account = await bootstrapLocalMailAccount(
      {
        userId: 'user-1',
        connectionId: 'connection-1',
      },
      {
        findByConnectionId: async () => ({
          id: 'account-1',
          userId: 'user-1',
          connectionId: 'connection-1',
        }),
        createAccount: async () => {
          createCalls += 1;
          throw new Error('must not create');
        },
      },
    );

    expect(account.id).toBe('account-1');
    expect(createCalls).toBe(0);
  });

  it('recovers a concurrent account creation by re-reading the connection', async () => {
    let reads = 0;
    const account = await bootstrapLocalMailAccount(
      {
        userId: 'user-1',
        connectionId: 'connection-1',
      },
      {
        findByConnectionId: async () => {
          reads += 1;
          return reads === 1
            ? null
            : {
                id: 'account-winner',
                userId: 'user-1',
                connectionId: 'connection-1',
              };
        },
        createAccount: async () => {
          throw new Error('unique conflict');
        },
      },
    );

    expect(account.id).toBe('account-winner');
    expect(reads).toBe(2);
  });
});

describe('inbound synchronization activation', () => {
  it('activates from the current checkpoint without creating Watch when it is disabled', async () => {
    const calls: string[] = [];
    const activated = await activateInboundSync(
      {
        accountId: 'account-1',
        connectionId: 'connection-1',
        provider: 'gmail',
        scopeKey: 'inbox',
        scope,
        subscriptionTarget: null,
      },
      {
        adapterFactory: {
          create: async () => ({
            provider: 'gmail',
            establishCheckpoint: async () => {
              calls.push('checkpoint');
              return { version: 1, historyId: '100' };
            },
            discover: async () => {
              throw new Error('unused');
            },
            fetchRawMessage: async () => {
              throw new Error('unused');
            },
            classifyError: () => 'permanent',
          }),
        },
        repository: {
          createActivatingSync: async () => ({
            id: 'sync-1',
            status: 'activating',
            checkpoint: null,
          }),
          prepareActivation: async () => {
            throw new Error('unused');
          },
          storeActivationCheckpoint: async ({ checkpoint }) => ({
            id: 'sync-1',
            status: 'activating',
            checkpoint,
          }),
          activate: async ({ subscriptionExpiresAt, subscriptionWarning }) => {
            calls.push('activate');
            expect(subscriptionExpiresAt).toBeNull();
            expect(subscriptionWarning).toBeNull();
            return {
              id: 'sync-1',
              status: 'active',
              checkpoint: { version: 1, historyId: '100' },
              subscriptionExpiresAt,
            };
          },
        },
      },
    );

    expect(calls).toEqual(['checkpoint', 'activate']);
    expect(activated.status).toBe('active');
  });

  it('keeps the checkpointed sync active and records a warning when Watch fails', async () => {
    const watchFailure = new Error('topic permission denied');
    const activated = await activateInboundSync(
      {
        accountId: 'account-1',
        connectionId: 'connection-1',
        provider: 'gmail',
        scopeKey: 'inbox',
        scope,
        subscriptionTarget: {
          version: 1,
          topicName: 'projects/zero/topics/gmail-inbound',
        },
      },
      {
        adapterFactory: {
          create: async () => ({
            provider: 'gmail',
            establishCheckpoint: async () => ({ version: 1, historyId: '100' }),
            discover: async () => {
              throw new Error('unused');
            },
            fetchRawMessage: async () => {
              throw new Error('unused');
            },
            subscribe: async () => {
              throw watchFailure;
            },
            classifyError: () => 'permanent',
          }),
        },
        repository: {
          createActivatingSync: async () => ({
            id: 'sync-1',
            status: 'activating',
            checkpoint: null,
          }),
          prepareActivation: async () => {
            throw new Error('unused');
          },
          storeActivationCheckpoint: async ({ checkpoint }) => ({
            id: 'sync-1',
            status: 'activating',
            checkpoint,
          }),
          activate: async ({ subscriptionExpiresAt, subscriptionWarning }) => {
            expect(subscriptionExpiresAt).toBeNull();
            expect(subscriptionWarning).toEqual({
              code: 'MAIL_SYNC_SUBSCRIPTION_FAILED',
              message: 'topic permission denied',
            });
            return {
              id: 'sync-1',
              status: 'active',
              checkpoint: { version: 1, historyId: '100' },
              subscriptionExpiresAt,
            };
          },
        },
      },
    );

    expect(activated.status).toBe('active');
  });

  it('does not activate when establishing the provider checkpoint fails', async () => {
    let activateCalls = 0;

    await expect(
      activateInboundSync(
        {
          accountId: 'account-1',
          connectionId: 'connection-1',
          provider: 'gmail',
          scopeKey: 'inbox',
          scope,
          subscriptionTarget: null,
        },
        {
          adapterFactory: {
            create: async () => ({
              provider: 'gmail',
              establishCheckpoint: async () => {
                throw new Error('invalid credentials');
              },
              discover: async () => {
                throw new Error('unused');
              },
              fetchRawMessage: async () => {
                throw new Error('unused');
              },
              classifyError: () => 'authentication',
            }),
          },
          repository: {
            createActivatingSync: async () => ({
              id: 'sync-1',
              status: 'activating',
              checkpoint: null,
            }),
            prepareActivation: async () => {
              throw new Error('unused');
            },
            storeActivationCheckpoint: async () => {
              throw new Error('must not store');
            },
            activate: async () => {
              activateCalls += 1;
              throw new Error('must not activate');
            },
          },
        },
      ),
    ).rejects.toThrow('invalid credentials');
    expect(activateCalls).toBe(0);
  });

  it('persists the provider baseline before subscribing and becoming active', async () => {
    const calls: string[] = [];
    let storedCheckpoint: { version: number; historyId: string } | null = null;
    const adapter: InboundMailAdapter = {
      provider: 'gmail',
      establishCheckpoint: async () => {
        calls.push('profile');
        return { version: 1, historyId: '100' };
      },
      discover: async () => {
        throw new Error('unused');
      },
      fetchRawMessage: async () => {
        throw new Error('unused');
      },
      subscribe: async ({ checkpoint, target }) => {
        calls.push('watch');
        expect(checkpoint).toEqual(storedCheckpoint);
        expect(target).toEqual({
          version: 1,
          topicName: 'projects/zero/topics/connection-1',
        });
        return {
          expiresAt: new Date('2026-08-01T00:00:00.000Z'),
          externalId: 'subscription-1',
          endpointTokenHash: null,
          encryptedSecret: 'encrypted-client-state',
          establishedAt: new Date('2026-07-28T12:00:00.000Z'),
        };
      },
      classifyError: () => 'permanent',
    };
    const adapterFactory: InboundMailAdapterFactory = {
      create: async () => adapter,
    };

    const activated = await activateInboundSync(
      {
        accountId: 'account-1',
        connectionId: 'connection-1',
        provider: 'gmail',
        scopeKey: 'inbox',
        scope,
        subscriptionTarget: {
          version: 1,
          topicName: 'projects/zero/topics/connection-1',
        },
      },
      {
        adapterFactory,
        repository: {
          createActivatingSync: async () => {
            calls.push('create-sync');
            return {
              id: 'sync-1',
              status: 'activating',
              checkpoint: null,
            };
          },
          prepareActivation: async () => {
            throw new Error('must not prepare a new sync');
          },
          storeActivationCheckpoint: async ({ checkpoint }) => {
            calls.push('store-baseline');
            storedCheckpoint = checkpoint as typeof storedCheckpoint;
            return {
              id: 'sync-1',
              status: 'activating',
              checkpoint,
            };
          },
          activate: async ({
            subscriptionExpiresAt,
            subscriptionExternalId,
            encryptedSubscriptionSecret,
          }) => {
            calls.push('activate');
            expect(subscriptionExternalId).toBe('subscription-1');
            expect(encryptedSubscriptionSecret).toBe('encrypted-client-state');
            return {
              id: 'sync-1',
              status: 'active',
              checkpoint: storedCheckpoint,
              subscriptionExpiresAt,
            };
          },
        },
      },
    );

    expect(calls).toEqual(['create-sync', 'profile', 'store-baseline', 'watch', 'activate']);
    expect(activated).toMatchObject({
      id: 'sync-1',
      status: 'active',
      checkpoint: { version: 1, historyId: '100' },
    });
  });

  it('does not create another Watch when an active activation command is replayed', async () => {
    let adapterCreations = 0;

    const result = await activateInboundSync(
      {
        accountId: 'account-1',
        connectionId: 'connection-1',
        provider: 'gmail',
        scopeKey: 'inbox',
        scope,
        subscriptionTarget: {
          version: 1,
          topicName: 'unused',
        },
      },
      {
        adapterFactory: {
          create: async () => {
            adapterCreations += 1;
            throw new Error('must not create an adapter');
          },
        },
        repository: {
          createActivatingSync: async () => ({
            id: 'sync-1',
            status: 'active',
            checkpoint: { version: 1, historyId: '101' },
          }),
          prepareActivation: async () => {
            throw new Error('must not prepare an active sync');
          },
          storeActivationCheckpoint: async () => {
            throw new Error('must not store');
          },
          activate: async () => {
            throw new Error('must not activate');
          },
        },
      },
    );

    expect(result).toMatchObject({ id: 'sync-1', status: 'active' });
    expect(adapterCreations).toBe(0);
  });

  it('reactivates a paused sync from a fresh checkpoint without historical import', async () => {
    const calls: string[] = [];
    let storedCheckpoint: { version: number; historyId: string } | null = null;

    const result = await activateInboundSync(
      {
        accountId: 'account-1',
        connectionId: 'connection-1',
        provider: 'gmail',
        scopeKey: 'inbox',
        scope,
        subscriptionTarget: {
          version: 1,
          topicName: 'projects/zero/topics/inbound',
        },
      },
      {
        adapterFactory: {
          create: async () => ({
            provider: 'gmail',
            establishCheckpoint: async () => {
              calls.push('profile');
              return { version: 1, historyId: '200' };
            },
            discover: async () => {
              throw new Error('unused');
            },
            fetchRawMessage: async () => {
              throw new Error('unused');
            },
            subscribe: async ({ checkpoint }) => {
              calls.push('watch');
              expect(checkpoint).toEqual({ version: 1, historyId: '200' });
              return { expiresAt: new Date('2026-08-02T00:00:00.000Z') };
            },
            classifyError: () => 'permanent',
          }),
        },
        repository: {
          createActivatingSync: async () => ({
            id: 'sync-1',
            status: 'paused',
            checkpoint: { version: 1, historyId: '100' },
          }),
          prepareActivation: async ({ syncId }) => {
            calls.push('prepare');
            expect(syncId).toBe('sync-1');
            return {
              id: 'sync-1',
              status: 'activating',
              checkpoint: null,
            };
          },
          storeActivationCheckpoint: async ({ checkpoint }) => {
            calls.push('store-baseline');
            storedCheckpoint = checkpoint as typeof storedCheckpoint;
            return {
              id: 'sync-1',
              status: 'activating',
              checkpoint,
            };
          },
          activate: async ({ subscriptionExpiresAt }) => {
            calls.push('activate');
            return {
              id: 'sync-1',
              status: 'active',
              checkpoint: storedCheckpoint,
              subscriptionExpiresAt,
            };
          },
        },
      },
    );

    expect(calls).toEqual(['prepare', 'profile', 'store-baseline', 'watch', 'activate']);
    expect(result).toMatchObject({
      status: 'active',
      checkpoint: { version: 1, historyId: '200' },
    });
  });
});
