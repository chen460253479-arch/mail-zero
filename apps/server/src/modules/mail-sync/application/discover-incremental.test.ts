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
          persistDiscoveryPage: async (input) => {
            calls.push(`persist:${input.events[0]?.remoteMessageId}`);
            persisted.push(input);
            return { inserted: input.events.length };
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
      'discover:first',
      'persist:message-1',
      'discover:next',
      'persist:message-2',
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
          persistDiscoveryPage: async () => ({ inserted: 0 }),
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
            persistDiscoveryPage: async () => ({ inserted: 0 }),
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
            persistDiscoveryPage: async () => ({ inserted: 0 }),
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
});
