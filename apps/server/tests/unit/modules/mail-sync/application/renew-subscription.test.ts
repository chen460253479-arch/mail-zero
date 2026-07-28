import { describe, expect, it } from 'vitest';

import { renewInboundSubscription } from '../../../../../src/modules/mail-sync/application/renew-subscription';
import type {
  InboundMailAdapter,
  IngressScope,
} from '../../../../../src/modules/mail-sync/domain/ingress-adapter';
import { MailSyncError } from '../../../../../src/modules/mail-sync/domain/errors';

const createAdapter = (
  subscribe: NonNullable<InboundMailAdapter['subscribe']>,
): InboundMailAdapter => ({
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
  subscribe,
  classifyError: (error) => (error instanceof MailSyncError ? error.classification : 'retryable'),
});

const scope: IngressScope = {
  version: 1,
  mailboxRoles: ['inbox'],
  initialSync: 'none',
};

const activeSync = (
  checkpoint: { version: 1; historyId: string } | null = {
    version: 1,
    historyId: '250',
  },
) => ({
  id: 'sync-1',
  accountId: 'account-1',
  provider: 'gmail',
  scope,
  checkpoint,
});

describe('inbound subscription renewal', () => {
  it('renews from the persisted checkpoint without replacing it', async () => {
    const updates: unknown[] = [];
    const adapter = createAdapter(async ({ checkpoint, target }) => {
      expect(checkpoint).toEqual({ version: 1, historyId: '250' });
      expect(target).toEqual({
        version: 1,
        topicName: 'projects/zero/topics/connection-1',
      });
      return { expiresAt: new Date('2026-08-10T00:00:00.000Z') };
    });

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
          acquireSyncLease: async () => activeSync(),
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
        subscriptionWarning: null,
      },
    ]);
  });

  it('marks the mailbox authorization invalid when Watch renewal cannot authenticate', async () => {
    const transitions: string[] = [];
    const adapter = createAdapter(async () => {
      throw new MailSyncError('GMAIL_RENEW_FAILED', 'authentication');
    });

    const result = await renewInboundSubscription(
      {
        syncId: 'sync-1',
        owner: 'renew-worker',
        leaseForMs: 60_000,
        subscriptionTarget: { version: 1, topicName: 'topic-1' },
      },
      {
        repository: {
          acquireSyncLease: async () => activeSync(),
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

    expect(result).toEqual({ status: 'auth_error' });
    expect(transitions).toEqual(['markAuthError']);
  });

  it('records a Watch warning without pausing scheduled incremental sync', async () => {
    const updates: unknown[] = [];
    const transitions: string[] = [];
    const adapter = createAdapter(async () => {
      throw new MailSyncError('GMAIL_RENEW_FAILED', 'permanent');
    });

    const result = await renewInboundSubscription(
      {
        syncId: 'sync-1',
        owner: 'renew-worker',
        leaseForMs: 60_000,
        subscriptionTarget: { version: 1, topicName: 'topic-1' },
      },
      {
        repository: {
          acquireSyncLease: async () => activeSync(),
          updateSubscription: async (input) => {
            updates.push(input);
          },
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

    expect(result).toEqual({ status: 'warning' });
    expect(transitions).toEqual([]);
    expect(updates).toEqual([
      {
        syncId: 'sync-1',
        owner: 'renew-worker',
        subscriptionExpiresAt: null,
        subscriptionWarning: {
          code: 'GMAIL_RENEW_FAILED',
          message: 'GMAIL_RENEW_FAILED',
        },
      },
    ]);
  });

  it('still pauses a structurally invalid renewal before calling the Watch adapter', async () => {
    const transitions: string[] = [];

    const result = await renewInboundSubscription(
      {
        syncId: 'sync-1',
        owner: 'renew-worker',
        leaseForMs: 60_000,
        subscriptionTarget: { version: 1, topicName: 'topic-1' },
      },
      {
        repository: {
          acquireSyncLease: async () => activeSync(null),
          updateSubscription: async () => undefined,
          markAuthError: async () => undefined,
          pauseSync: async () => {
            transitions.push('pauseSync');
          },
          releaseSyncLease: async () => undefined,
        },
        resolveConnectionId: async () => {
          throw new Error('must not resolve a connection');
        },
        getAdapterFactory: () => {
          throw new Error('must not resolve an adapter');
        },
      },
    );

    expect(result).toEqual({ status: 'paused' });
    expect(transitions).toEqual(['pauseSync']);
  });
});
