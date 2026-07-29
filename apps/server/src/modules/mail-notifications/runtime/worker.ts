import type { ClaimedMailNotification } from '../domain/event';

export type MailNotificationWorker = {
  start(): void;
  stop(): Promise<void>;
  notify(): void;
};

type CreateMailNotificationWorkerDependencies = {
  repository: {
    claim(input: {
      owner: string;
      now: Date;
      limit: number;
      leaseForMs: number;
    }): Promise<ClaimedMailNotification[]>;
  };
  deliver(event: ClaimedMailNotification): Promise<void>;
  concurrency: number;
  pollIntervalMs: number;
  leaseForMs: number;
  clock: {
    now(): Date;
  };
  newOwner(): string;
  logger?: {
    error(message: string, error: unknown): void;
  };
};

const requirePositiveInteger = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`MAIL_NOTIFICATION_WORKER_INVALID_${name}`);
  }
};

export const createMailNotificationWorker = (
  dependencies: CreateMailNotificationWorkerDependencies,
): MailNotificationWorker => {
  requirePositiveInteger('CONCURRENCY', dependencies.concurrency);
  requirePositiveInteger('POLL_INTERVAL_MS', dependencies.pollIntervalMs);
  requirePositiveInteger('LEASE_FOR_MS', dependencies.leaseForMs);

  const logger = dependencies.logger ?? console;
  const waiters = new Set<() => void>();
  let state: 'idle' | 'running' | 'stopping' = 'idle';
  let wakeVersion = 0;
  let controller: AbortController | null = null;
  let loops: Promise<void>[] = [];
  let stopping: Promise<void> | null = null;

  const wakeWaiters = (): void => {
    for (const wake of [...waiters]) wake();
  };

  const waitForPoll = async (signal: AbortSignal, observedWakeVersion: number): Promise<void> => {
    if (signal.aborted || wakeVersion !== observedWakeVersion) return;
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        waiters.delete(finish);
        resolve();
      };
      waiters.add(finish);
      signal.addEventListener('abort', finish, { once: true });
      timer = setTimeout(finish, dependencies.pollIntervalMs);
      if (signal.aborted || wakeVersion !== observedWakeVersion) finish();
    });
  };

  const runLoop = async (owner: string, signal: AbortSignal): Promise<void> => {
    while (state === 'running' && !signal.aborted) {
      const observedWakeVersion = wakeVersion;
      try {
        const events = await dependencies.repository.claim({
          owner,
          now: dependencies.clock.now(),
          limit: 1,
          leaseForMs: dependencies.leaseForMs,
        });
        if (state !== 'running' || signal.aborted) return;
        const event = events[0];
        if (event === undefined) {
          await waitForPoll(signal, observedWakeVersion);
          continue;
        }
        await dependencies.deliver(event);
      } catch (error) {
        logger.error('[MAIL_NOTIFICATION_WORKER] loop failed', error);
      }
    }
  };

  return {
    start() {
      if (state !== 'idle') return;
      state = 'running';
      controller = new AbortController();
      const signal = controller.signal;
      loops = Array.from({ length: dependencies.concurrency }, () =>
        runLoop(dependencies.newOwner(), signal),
      );
    },
    async stop() {
      if (state === 'idle') return;
      if (stopping !== null) return stopping;
      state = 'stopping';
      controller?.abort();
      wakeWaiters();
      const activeLoops = loops;
      stopping = Promise.allSettled(activeLoops).then(() => {
        loops = [];
        controller = null;
        stopping = null;
        state = 'idle';
      });
      return stopping;
    },
    notify() {
      if (state !== 'running') return;
      wakeVersion += 1;
      wakeWaiters();
    },
  };
};

export const createDisabledMailNotificationWorker = (): MailNotificationWorker => ({
  start: () => undefined,
  stop: async () => undefined,
  notify: () => undefined,
});
