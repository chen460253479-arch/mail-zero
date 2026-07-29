import { describe, expect, it, vi } from 'vitest';

import {
  createMailTaskWorker,
  MAIL_TASK_MAX_RETRY_DELAY_MS,
  MAIL_TASK_RETRY_BASE_DELAY_MS,
  type ClaimedMailTask,
  type EnqueueMailTaskInput,
  type MailTaskRepository,
} from '../../../../src/modules/mail-tasks';
import { MailSyncError } from '../../../../src/modules/mail-sync/domain/errors';
import { MailOutboundError } from '../../../../src/modules/mail-outbound';

const now = new Date('2026-07-29T00:00:00.000Z');

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('TEST_WAIT_TIMEOUT');
};

class FakeMailTaskRepository implements MailTaskRepository {
  readonly ready: ClaimedMailTask[] = [];
  readonly completed: Array<{ id: string; owner: string; now: Date }> = [];
  readonly retried: Array<Parameters<MailTaskRepository['retry']>[0]> = [];
  readonly failed: Array<Parameters<MailTaskRepository['failPermanently']>[0]> = [];
  claimCalls = 0;

  enqueue(_input: EnqueueMailTaskInput): Promise<{ id: string; created: boolean }> {
    throw new Error('Not implemented for this test');
  }

  async claim(input: Parameters<MailTaskRepository['claim']>[0]): Promise<ClaimedMailTask[]> {
    this.claimCalls += 1;
    const task = this.ready.shift();
    if (task === undefined) return [];
    return [
      {
        ...task,
        leaseOwner: input.owner,
        leaseExpiresAt: new Date(input.now.getTime() + input.leaseForMs),
      },
    ];
  }

  async complete(input: Parameters<MailTaskRepository['complete']>[0]): Promise<boolean> {
    this.completed.push(input);
    return true;
  }

  async retry(
    input: Parameters<MailTaskRepository['retry']>[0],
  ): Promise<'retry' | 'dead' | 'lost'> {
    this.retried.push(input);
    return 'retry';
  }

  async failPermanently(
    input: Parameters<MailTaskRepository['failPermanently']>[0],
  ): Promise<boolean> {
    this.failed.push(input);
    return true;
  }

  async recoverExpired(): Promise<number> {
    return 0;
  }
}

const task = (
  id: string,
  queue: ClaimedMailTask['queue'],
  command: unknown,
  attempts = 1,
): ClaimedMailTask => ({
  id,
  queue,
  command,
  attempts,
  leaseOwner: 'unclaimed',
  leaseExpiresAt: now,
});

const createWorker = (
  repository: MailTaskRepository,
  overrides: Partial<Parameters<typeof createMailTaskWorker>[0]> = {},
) =>
  createMailTaskWorker({
    repository,
    processIngress: async () => undefined,
    processOutbound: async () => undefined,
    concurrency: 1,
    pollIntervalMs: 5,
    leaseForMs: 30_000,
    clock: { now: () => new Date(now) },
    newOwner: () => crypto.randomUUID(),
    logger: { error: vi.fn() },
    ...overrides,
  });

describe('MailTaskWorker', () => {
  it('bounds concurrency, routes both queues, and completes successful work', async () => {
    const repository = new FakeMailTaskRepository();
    repository.ready.push(
      task('ingress-1', 'ingress', { type: 'discover', syncId: 'sync-1' }),
      task('outbound-1', 'outbound', { type: 'deliver', deliveryId: 'delivery-1' }),
      task('ingress-2', 'ingress', { type: 'import', syncId: 'sync-2' }),
    );
    const gates = new Map([
      ['sync-1', deferred()],
      ['delivery-1', deferred()],
      ['sync-2', deferred()],
    ]);
    const routed: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const process = async (key: string) => {
      routed.push(key);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await gates.get(key)!.promise;
      active -= 1;
    };
    const worker = createWorker(repository, {
      concurrency: 2,
      processIngress: (command) =>
        process(command.type === 'signal' ? command.externalAccount : command.syncId),
      processOutbound: (command) =>
        process(command.type === 'dispatch' ? 'dispatch' : command.deliveryId),
    });

    worker.start();
    try {
      await waitUntil(() => active === 2);
      expect(maximumActive).toBe(2);
      expect(routed).toEqual(expect.arrayContaining(['sync-1', 'delivery-1']));

      gates.get('sync-1')!.resolve();
      gates.get('delivery-1')!.resolve();
      await waitUntil(() => routed.includes('sync-2'));
      gates.get('sync-2')!.resolve();
      await waitUntil(() => repository.completed.length === 3);

      expect(maximumActive).toBe(2);
      expect(repository.completed.map(({ id }) => id).sort()).toEqual([
        'ingress-1',
        'ingress-2',
        'outbound-1',
      ]);
    } finally {
      for (const gate of gates.values()) gate.resolve();
      await worker.stop();
    }
  });

  it('terminates permanent errors and exponentially backs off retryable errors', async () => {
    const repository = new FakeMailTaskRepository();
    repository.ready.push(
      task('sync-permanent', 'ingress', { type: 'discover', syncId: 'permanent' }),
      task('outbound-permanent', 'outbound', {
        type: 'deliver',
        deliveryId: 'permanent',
      }),
      task('sync-retry-first', 'ingress', { type: 'discover', syncId: 'retry-first' }),
      task('sync-retry-bounded', 'ingress', { type: 'discover', syncId: 'retry-bounded' }, 100),
    );
    const worker = createWorker(repository, {
      processIngress: async (command) => {
        const syncId = command.type === 'signal' ? command.externalAccount : command.syncId;
        if (syncId === 'permanent') {
          throw new MailSyncError('MAIL_SYNC_INVALID_REMOTE_DATA', 'permanent');
        }
        throw new MailSyncError('MAIL_SYNC_PROVIDER_UNAVAILABLE', 'retryable');
      },
      processOutbound: async () => {
        throw new MailOutboundError('INVALID_DELIVERY_TRANSITION', 'permanent');
      },
    });

    worker.start();
    try {
      await waitUntil(() => repository.failed.length === 2 && repository.retried.length === 2);

      expect(repository.failed.map(({ id, errorCode }) => ({ id, errorCode }))).toEqual([
        {
          id: 'sync-permanent',
          errorCode: 'MAIL_SYNC_INVALID_REMOTE_DATA',
        },
        {
          id: 'outbound-permanent',
          errorCode: 'INVALID_DELIVERY_TRANSITION',
        },
      ]);
      expect(repository.retried[0]!.runAt.getTime() - now.getTime()).toBe(
        MAIL_TASK_RETRY_BASE_DELAY_MS,
      );
      expect(repository.retried[1]!.runAt.getTime() - now.getTime()).toBe(
        MAIL_TASK_MAX_RETRY_DELAY_MS,
      );
    } finally {
      await worker.stop();
    }
  });

  it('wakes a sleeping poll immediately when notified', async () => {
    const repository = new FakeMailTaskRepository();
    const processed = vi.fn(async () => undefined);
    const worker = createWorker(repository, {
      pollIntervalMs: 60_000,
      processIngress: processed,
    });

    worker.start();
    try {
      await waitUntil(() => repository.claimCalls > 0);
      repository.ready.push(
        task('notified', 'ingress', { type: 'discover', syncId: 'sync-notified' }),
      );
      worker.notify();
      await waitUntil(() => processed.mock.calls.length === 1);

      expect(repository.completed).toHaveLength(1);
    } finally {
      await worker.stop();
    }
  });

  it('stops claiming new work and waits for active processing', async () => {
    const repository = new FakeMailTaskRepository();
    repository.ready.push(
      task('active', 'ingress', { type: 'discover', syncId: 'sync-active' }),
      task('must-not-start', 'ingress', { type: 'discover', syncId: 'sync-pending' }),
    );
    const gate = deferred();
    const processingStarted = vi.fn();
    const worker = createWorker(repository, {
      processIngress: async () => {
        processingStarted();
        await gate.promise;
      },
    });

    worker.start();
    await waitUntil(() => processingStarted.mock.calls.length === 1);
    let stopped = false;
    const stopping = worker.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(stopped).toBe(false);
    expect(repository.claimCalls).toBe(1);

    gate.resolve();
    await stopping;
    expect(repository.claimCalls).toBe(1);
    expect(repository.ready).toHaveLength(1);
  });

  it('continues processing after one task throws unexpectedly', async () => {
    const repository = new FakeMailTaskRepository();
    repository.ready.push(
      task('broken', 'ingress', { type: 'discover', syncId: 'broken' }),
      task('healthy', 'outbound', { type: 'deliver', deliveryId: 'healthy' }),
    );
    const worker = createWorker(repository, {
      processIngress: async () => {
        throw new Error('unexpected processor failure');
      },
    });

    worker.start();
    try {
      await waitUntil(() => repository.retried.length === 1 && repository.completed.length === 1);
      expect(repository.retried[0]).toMatchObject({
        id: 'broken',
        errorCode: 'MAIL_TASK_PROCESSING_FAILED',
      });
      expect(repository.completed[0]!.id).toBe('healthy');
    } finally {
      await worker.stop();
    }
  });
});
