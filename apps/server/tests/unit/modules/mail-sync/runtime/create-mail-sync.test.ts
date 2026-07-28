import { describe, expect, it } from 'vitest';

import {
  createMailIngressRuntime,
  dispatchDueMailSyncWork,
  processMailIngressCommand,
  type MailIngressRuntime,
} from '../../../../../src/modules/mail-sync/runtime/create-mail-sync';
import type { PostgresMailSyncRepository } from '../../../../../src/modules/mail-sync/postgres/sync-repository';
import type { CompleteDiscoveryRunInput } from '../../../../../src/modules/mail-sync/postgres/types';
import { parseMailIngressCommand } from '../../../../../src/modules/mail-sync/application/commands';

const createRuntime = (overrides: Partial<MailIngressRuntime> = {}): MailIngressRuntime => ({
  receiveSignal: async () => ({ matched: 0 }),
  discover: async () => ({ status: 'completed', inserted: 0 }),
  importPending: async () => ({
    claimed: 0,
    imported: 0,
    retried: 0,
    failed: 0,
  }),
  renew: async () => ({ status: 'renewed' }),
  enqueue: async () => undefined,
  ...overrides,
});

describe('mail ingress queue command processor', () => {
  it('uses the channel reconciliation interval when discovery completes', async () => {
    let reconcileAfterMs: number | null = null;
    const runtime = createMailIngressRuntime({
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
          checkpoint: { version: 1, historyId: '100' },
          requestedGeneration: 0,
          completedGeneration: 0,
          pendingCursorHint: null,
        }),
        renewSyncLease: async () => true,
        persistDiscoveryPage: async () => ({ inserted: 0 }),
        completeDiscoveryRun: async (input: CompleteDiscoveryRunInput) => {
          reconcileAfterMs = input.reconcileAfterMs;
          return {
            requestedGeneration: 0,
            completedGeneration: 0,
            checkpoint: input.checkpoint,
          };
        },
        releaseSyncLease: async () => undefined,
      } as unknown as PostgresMailSyncRepository,
      getAdapterFactory: () => ({
        create: async () => ({
          provider: 'gmail',
          establishCheckpoint: async () => ({ version: 1, historyId: '100' }),
          discover: async () => ({
            events: [],
            checkpoint: { version: 1, historyId: '100' },
            nextPageToken: null,
          }),
          fetchRawMessage: async () => {
            throw new Error('unused');
          },
          classifyError: () => 'retryable',
        }),
      }),
      resolveConnectionId: async () => 'connection-1',
      resolveImportContext: async () => {
        throw new Error('unused');
      },
      resolveSubscriptionTarget: async () => null,
      mailCore: {
        importEmail: async () => {
          throw new Error('unused');
        },
      },
      onAuthenticationError: async () => undefined,
      enqueue: async () => undefined,
      newLeaseOwner: () => 'worker-1',
      clock: { now: () => new Date('2026-07-28T08:00:00.000Z') },
      reconcileAfterMs: 30 * 60_000,
    });

    await runtime.discover({ type: 'reconcile', syncId: 'sync-1' });

    expect(reconcileAfterMs).toBe(30 * 60_000);
  });

  it('rejects malformed queue commands as permanent input errors', () => {
    expect(() => parseMailIngressCommand({ type: 'discover' })).toThrow(
      'MAIL_SYNC_INVALID_COMMAND',
    );
    expect(() => parseMailIngressCommand({ type: 'unknown', syncId: 'sync-1' })).toThrow(
      'MAIL_SYNC_INVALID_COMMAND',
    );
  });

  it('queues import after discovery persisted new items', async () => {
    const queued: unknown[] = [];
    await processMailIngressCommand(
      { type: 'discover', syncId: 'sync-1' },
      createRuntime({
        discover: async () => ({ status: 'completed', inserted: 2 }),
        enqueue: async (command) => {
          queued.push(command);
        },
      }),
    );
    expect(queued).toEqual([{ type: 'import', syncId: 'sync-1' }]);
  });

  it('continues bounded import batches when the claim limit was filled', async () => {
    const queued: unknown[] = [];
    await processMailIngressCommand(
      { type: 'import', syncId: 'sync-1' },
      createRuntime({
        importPending: async () => ({
          claimed: 25,
          imported: 25,
          retried: 0,
          failed: 0,
        }),
        importBatchSize: 25,
        enqueue: async (command) => {
          queued.push(command);
        },
      }),
    );
    expect(queued).toEqual([{ type: 'import', syncId: 'sync-1' }]);
  });

  it('treats reconcile as discovery and forwards signal and renew commands', async () => {
    const calls: string[] = [];
    const runtime = createRuntime({
      receiveSignal: async () => {
        calls.push('signal');
        return { matched: 1 };
      },
      discover: async () => {
        calls.push('discover');
        return { status: 'completed', inserted: 0 };
      },
      renew: async () => {
        calls.push('renew');
        return { status: 'renewed' };
      },
    });

    await processMailIngressCommand(
      {
        type: 'signal',
        provider: 'gmail',
        externalAccount: 'user@example.com',
      },
      runtime,
    );
    await processMailIngressCommand({ type: 'reconcile', syncId: 'sync-1' }, runtime);
    await processMailIngressCommand({ type: 'renew', syncId: 'sync-1' }, runtime);

    expect(calls).toEqual(['signal', 'discover', 'renew']);
  });
});

describe('mail ingress due-work dispatcher', () => {
  const dispatchInput = {
    owner: 'scheduler-1',
    limit: 10,
    claimLeaseForMs: 30_000,
    confirmedLeaseForMs: 120_000,
    retryAfterMs: 5_000,
    reconcileBefore: new Date('2026-01-01T00:00:00.000Z'),
    renewalBefore: new Date('2026-01-02T00:00:00.000Z'),
    importBefore: new Date('2026-01-01T00:00:00.000Z'),
  };

  it('enqueues all claimed responsibilities and confirms the durable dispatch', async () => {
    const calls: unknown[] = [];
    const result = await dispatchDueMailSyncWork(dispatchInput, {
      repository: {
        claimDueDispatches: async () => [
          {
            syncId: 'sync-1',
            discover: true,
            renew: true,
            importPending: true,
          },
        ],
        confirmDispatch: async (input) => {
          calls.push({ confirm: input });
          return true;
        },
        deferDispatch: async (input) => {
          calls.push({ defer: input });
        },
      },
      enqueue: async (command) => {
        calls.push(command);
      },
    });

    expect(result).toEqual({ reconciliations: 1, renewals: 1, imports: 1 });
    expect(calls).toEqual([
      { type: 'discover', syncId: 'sync-1' },
      { type: 'renew', syncId: 'sync-1' },
      { type: 'import', syncId: 'sync-1' },
      {
        confirm: {
          syncId: 'sync-1',
          owner: 'scheduler-1',
          leaseForMs: 120_000,
        },
      },
    ]);
  });

  it('shortens the dispatch lease when queue publication fails', async () => {
    const deferred: unknown[] = [];
    const failure = new Error('queue unavailable');

    await expect(
      dispatchDueMailSyncWork(dispatchInput, {
        repository: {
          claimDueDispatches: async () => [
            {
              syncId: 'sync-1',
              discover: true,
              renew: false,
              importPending: false,
            },
          ],
          confirmDispatch: async () => true,
          deferDispatch: async (input) => {
            deferred.push(input);
          },
        },
        enqueue: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(deferred).toEqual([
      {
        syncId: 'sync-1',
        owner: 'scheduler-1',
        retryAfterMs: 5_000,
      },
    ]);
  });

  it('continues dispatching other claimed syncs after one queue publication fails', async () => {
    const calls: unknown[] = [];
    const failure = new Error('first sync queue unavailable');

    await expect(
      dispatchDueMailSyncWork(dispatchInput, {
        repository: {
          claimDueDispatches: async () => [
            {
              syncId: 'sync-1',
              discover: true,
              renew: false,
              importPending: false,
            },
            {
              syncId: 'sync-2',
              discover: false,
              renew: false,
              importPending: true,
            },
          ],
          confirmDispatch: async (input) => {
            calls.push({ confirm: input.syncId });
            return true;
          },
          deferDispatch: async (input) => {
            calls.push({ defer: input.syncId });
          },
        },
        enqueue: async (command) => {
          calls.push(command);
          if ('syncId' in command && command.syncId === 'sync-1') {
            throw failure;
          }
        },
      }),
    ).rejects.toBe(failure);

    expect(calls).toEqual([
      { type: 'discover', syncId: 'sync-1' },
      { defer: 'sync-1' },
      { type: 'import', syncId: 'sync-2' },
      { confirm: 'sync-2' },
    ]);
  });
});
