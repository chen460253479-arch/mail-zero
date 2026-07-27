import { describe, expect, it } from 'vitest';

import { discoverIncremental, type DiscoverySyncRecord } from './discover-incremental';
import { MailSyncError, type InboundMailAdapter, type IngressScope } from '../index';

const scope: IngressScope = {
  version: 1,
  mailboxRoles: ['inbox'],
  initialSync: 'none',
};

const activeSync: DiscoverySyncRecord = {
  id: 'sync-1',
  accountId: 'account-1',
  provider: 'gmail',
  scope,
  checkpoint: { version: 1, historyId: '100' },
  requestedGeneration: 1,
  completedGeneration: 0,
  pendingCursorHint: '102',
};

describe('incremental mail discovery', () => {
  it('persists every page before requesting the next page and always releases the lease', async () => {
    const calls: string[] = [];
    const persisted: unknown[] = [];
    let page = 0;
    const adapter: InboundMailAdapter = {
      provider: 'gmail',
      establishCheckpoint: async () => {
        throw new Error('unused');
      },
      discover: async ({ checkpoint, pageToken }) => {
        calls.push(`discover:${pageToken ?? 'first'}`);
        expect(checkpoint).toEqual(
          page === 0 ? { version: 1, historyId: '100' } : { version: 1, historyId: '100' },
        );
        page += 1;
        return page === 1
          ? {
              events: [
                {
                  type: 'message_added',
                  remoteMessageId: 'message-1',
                  remoteThreadId: null,
                },
              ],
              checkpoint: { version: 1, historyId: '100' },
              nextPageToken: 'next',
            }
          : {
              events: [
                {
                  type: 'message_added',
                  remoteMessageId: 'message-2',
                  remoteThreadId: null,
                },
              ],
              checkpoint: { version: 1, historyId: '102' },
              nextPageToken: null,
            };
      },
      fetchRawMessage: async () => {
        throw new Error('unused');
      },
      classifyError: () => 'permanent',
    };

    const result = await discoverIncremental(
      { syncId: 'sync-1', owner: 'worker-1', leaseForMs: 60_000 },
      {
        repository: {
          acquireSyncLease: async () => {
            calls.push('lease');
            return activeSync;
          },
          renewSyncLease: async () => {
            calls.push('renew');
            return true;
          },
          persistDiscoveryPage: async (input) => {
            calls.push(`persist:${input.events[0]?.remoteMessageId}`);
            persisted.push(input);
            return { inserted: input.events.length };
          },
          completeDiscoveryRun: async (input) => {
            calls.push('complete');
            expect(input).toMatchObject({
              completedGeneration: 1,
              checkpoint: { version: 1, historyId: '102' },
            });
            return {
              requestedGeneration: 1,
              completedGeneration: 1,
              checkpoint: input.checkpoint,
            };
          },
          releaseSyncLease: async () => {
            calls.push('release');
          },
          pauseSync: async () => {
            throw new Error('must not pause');
          },
          markAuthError: async () => {
            throw new Error('must not mark auth error');
          },
        },
        getAdapterFactory: () => ({ create: async () => adapter }),
        resolveConnectionId: async () => 'connection-1',
      },
    );

    expect(result).toEqual({ status: 'completed', inserted: 2 });
    expect(calls).toEqual([
      'lease',
      'renew',
      'discover:first',
      'renew',
      'persist:message-1',
      'renew',
      'discover:next',
      'renew',
      'persist:message-2',
      'renew',
      'complete',
      'release',
    ]);
    expect(persisted).toHaveLength(2);
  });

  it('returns busy without constructing a provider adapter when the lease is held', async () => {
    let adapterLookups = 0;
    const result = await discoverIncremental(
      { syncId: 'sync-1', owner: 'worker-1', leaseForMs: 60_000 },
      {
        repository: {
          acquireSyncLease: async () => null,
          renewSyncLease: async () => true,
          persistDiscoveryPage: async () => ({ inserted: 0 }),
          completeDiscoveryRun: async () => {
            throw new Error('must not complete');
          },
          releaseSyncLease: async () => undefined,
          pauseSync: async () => undefined,
          markAuthError: async () => undefined,
        },
        getAdapterFactory: () => {
          adapterLookups += 1;
          throw new Error('must not resolve');
        },
        resolveConnectionId: async () => {
          throw new Error('must not resolve');
        },
      },
    );
    expect(result).toEqual({ status: 'busy', inserted: 0 });
    expect(adapterLookups).toBe(0);
  });

  it.each([
    ['permanent', 'paused', 'pauseSync'],
    ['authentication', 'auth_error', 'markAuthError'],
  ] as const)(
    'moves a %s provider failure to %s without retrying',
    async (classification, expectedStatus, expectedMethod) => {
      const transitions: string[] = [];
      const error = new MailSyncError('DISCOVERY_FAILED', classification);
      const adapter: InboundMailAdapter = {
        provider: 'gmail',
        establishCheckpoint: async () => {
          throw new Error('unused');
        },
        discover: async () => {
          throw error;
        },
        fetchRawMessage: async () => {
          throw new Error('unused');
        },
        classifyError: () => classification,
      };

      const result = await discoverIncremental(
        { syncId: 'sync-1', owner: 'worker-1', leaseForMs: 60_000 },
        {
          repository: {
            acquireSyncLease: async () => activeSync,
            renewSyncLease: async () => true,
            persistDiscoveryPage: async () => ({ inserted: 0 }),
            completeDiscoveryRun: async () => {
              throw new Error('must not complete');
            },
            releaseSyncLease: async () => {
              transitions.push('release');
            },
            pauseSync: async () => {
              transitions.push('pauseSync');
            },
            markAuthError: async () => {
              transitions.push('markAuthError');
            },
          },
          getAdapterFactory: () => ({ create: async () => adapter }),
          resolveConnectionId: async () => 'connection-1',
        },
      );

      expect(result).toEqual({ status: expectedStatus, inserted: 0 });
      expect(transitions).toEqual([expectedMethod, 'release']);
    },
  );

  it('rethrows a retryable failure after releasing the stream lease', async () => {
    const transitions: string[] = [];
    const retryable = new Error('temporary');
    const adapter: InboundMailAdapter = {
      provider: 'gmail',
      establishCheckpoint: async () => {
        throw new Error('unused');
      },
      discover: async () => {
        throw retryable;
      },
      fetchRawMessage: async () => {
        throw new Error('unused');
      },
      classifyError: () => 'retryable',
    };

    await expect(
      discoverIncremental(
        { syncId: 'sync-1', owner: 'worker-1', leaseForMs: 60_000 },
        {
        repository: {
          acquireSyncLease: async () => activeSync,
          renewSyncLease: async () => true,
          persistDiscoveryPage: async () => ({ inserted: 0 }),
          completeDiscoveryRun: async () => {
            throw new Error('must not complete');
          },
          releaseSyncLease: async () => {
              transitions.push('release');
            },
            pauseSync: async () => {
              transitions.push('pause');
            },
            markAuthError: async () => {
              transitions.push('auth');
            },
          },
          getAdapterFactory: () => ({ create: async () => adapter }),
          resolveConnectionId: async () => 'connection-1',
        },
      ),
    ).rejects.toBe(retryable);
    expect(transitions).toEqual(['release']);
  });

  it('continues with the latest generation when a signal arrives during discovery', async () => {
    const checkpoints: string[] = [];
    const completedGenerations: number[] = [];
    let discoveryRun = 0;
    const adapter: InboundMailAdapter = {
      provider: 'gmail',
      establishCheckpoint: async () => {
        throw new Error('unused');
      },
      discover: async ({ checkpoint }) => {
        checkpoints.push(String((checkpoint as unknown as { historyId: string }).historyId));
        discoveryRun += 1;
        return {
          events: [],
          checkpoint: { version: 1, historyId: String(100 + discoveryRun) },
          nextPageToken: null,
        };
      },
      fetchRawMessage: async () => {
        throw new Error('unused');
      },
      classifyError: () => 'retryable',
    };

    const result = await discoverIncremental(
      { syncId: 'sync-1', owner: 'worker-1', leaseForMs: 60_000 },
      {
        repository: {
          acquireSyncLease: async () => activeSync,
          renewSyncLease: async () => true,
          persistDiscoveryPage: async () => ({ inserted: 0 }),
          completeDiscoveryRun: async (input) => {
            completedGenerations.push(input.completedGeneration);
            return {
              completedGeneration: input.completedGeneration,
              requestedGeneration: 2,
              checkpoint: input.checkpoint,
            };
          },
          releaseSyncLease: async () => undefined,
          pauseSync: async () => undefined,
          markAuthError: async () => undefined,
        },
        getAdapterFactory: () => ({ create: async () => adapter }),
        resolveConnectionId: async () => 'connection-1',
      },
    );

    expect(result).toEqual({ status: 'completed', inserted: 0 });
    expect(checkpoints).toEqual(['100', '101']);
    expect(completedGenerations).toEqual([1, 2]);
  });

  it('stops before persisting when the synchronization lease cannot be renewed', async () => {
    let renewals = 0;
    let persisted = false;
    const adapter: InboundMailAdapter = {
      provider: 'gmail',
      establishCheckpoint: async () => {
        throw new Error('unused');
      },
      discover: async () => ({
        events: [],
        checkpoint: { version: 1, historyId: '101' },
        nextPageToken: null,
      }),
      fetchRawMessage: async () => {
        throw new Error('unused');
      },
      classifyError: () => 'retryable',
    };

    await expect(
      discoverIncremental(
        { syncId: 'sync-1', owner: 'worker-1', leaseForMs: 60_000 },
        {
          repository: {
            acquireSyncLease: async () => activeSync,
            renewSyncLease: async () => {
              renewals += 1;
              return renewals === 1;
            },
            persistDiscoveryPage: async () => {
              persisted = true;
              return { inserted: 0 };
            },
            completeDiscoveryRun: async () => {
              throw new Error('must not complete');
            },
            releaseSyncLease: async () => undefined,
            pauseSync: async () => undefined,
            markAuthError: async () => undefined,
          },
          getAdapterFactory: () => ({ create: async () => adapter }),
          resolveConnectionId: async () => 'connection-1',
        },
      ),
    ).rejects.toMatchObject({ code: 'MAIL_SYNC_LEASE_LOST' });
    expect(persisted).toBe(false);
  });
});
