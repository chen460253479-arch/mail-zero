import { describe, expect, it } from 'vitest';

import { processMailIngressCommand, type MailIngressRuntime } from './create-mail-sync';
import { parseMailIngressCommand } from '../application/commands';

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
