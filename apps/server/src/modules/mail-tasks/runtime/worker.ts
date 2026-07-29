import { MailOutboundError, parseMailOutboundCommand } from '../../mail-outbound';
import type { MailIngressCommand } from '../../mail-sync/application/commands';
import { parseMailIngressCommand } from '../../mail-sync/application/commands';
import type { ClaimedMailTask, MailTaskRepository } from '../domain/task';
import type { MailOutboundCommand } from '../../mail-outbound';
import { MailSyncError } from '../../mail-sync/domain/errors';

export const MAIL_TASK_RETRY_BASE_DELAY_MS = 1_000;
export const MAIL_TASK_MAX_RETRY_DELAY_MS = 15 * 60_000;
const MAIL_TASK_ERROR_MESSAGE_MAX_LENGTH = 2_048;

export type MailTaskWorker = {
  start(): void;
  stop(): Promise<void>;
  notify(): void;
};

type MailTaskWorkerLogger = {
  error(message: string, error: unknown): void;
};

export type CreateMailTaskWorkerDependencies = {
  repository: MailTaskRepository;
  processIngress(command: MailIngressCommand): Promise<void>;
  processOutbound(command: MailOutboundCommand): Promise<void>;
  concurrency: number;
  pollIntervalMs: number;
  leaseForMs: number;
  clock: { now(): Date };
  newOwner(): string;
  logger?: MailTaskWorkerLogger;
};

const requirePositiveInteger = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`MAIL_TASK_WORKER_INVALID_${name}`);
  }
};

const errorCode = (error: unknown): string => {
  if (error instanceof MailSyncError || error instanceof MailOutboundError) {
    return error.code;
  }
  return 'MAIL_TASK_PROCESSING_FAILED';
};

const errorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAIL_TASK_ERROR_MESSAGE_MAX_LENGTH);
};

const isPermanent = (error: unknown): boolean =>
  error instanceof TypeError ||
  (error instanceof MailSyncError && error.classification !== 'retryable') ||
  (error instanceof MailOutboundError && error.disposition === 'permanent');

const retryAt = (now: Date, attempts: number): Date => {
  const exponent = Math.max(0, Math.min(30, attempts - 1));
  const delay = Math.min(
    MAIL_TASK_MAX_RETRY_DELAY_MS,
    MAIL_TASK_RETRY_BASE_DELAY_MS * 2 ** exponent,
  );
  return new Date(now.getTime() + delay);
};

export const createMailTaskWorker = (
  dependencies: CreateMailTaskWorkerDependencies,
): MailTaskWorker => {
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

  const processTask = async (task: ClaimedMailTask): Promise<void> => {
    try {
      if (task.queue === 'ingress') {
        await dependencies.processIngress(parseMailIngressCommand(task.command));
      } else {
        await dependencies.processOutbound(parseMailOutboundCommand(task.command));
      }
      await dependencies.repository.complete({
        id: task.id,
        owner: task.leaseOwner,
        now: dependencies.clock.now(),
      });
    } catch (error) {
      const now = dependencies.clock.now();
      const failure = {
        id: task.id,
        owner: task.leaseOwner,
        now,
        errorCode: errorCode(error),
        errorMessage: errorMessage(error),
      };
      if (isPermanent(error)) {
        await dependencies.repository.failPermanently(failure);
        return;
      }
      await dependencies.repository.retry({
        ...failure,
        runAt: retryAt(now, task.attempts),
      });
    }
  };

  const runLoop = async (owner: string, signal: AbortSignal): Promise<void> => {
    while (state === 'running' && !signal.aborted) {
      const observedWakeVersion = wakeVersion;
      try {
        const tasks = await dependencies.repository.claim({
          owner,
          queues: ['ingress', 'outbound'],
          now: dependencies.clock.now(),
          limit: 1,
          leaseForMs: dependencies.leaseForMs,
        });
        if (state !== 'running' || signal.aborted) return;
        const claimed = tasks[0];
        if (claimed === undefined) {
          await waitForPoll(signal, observedWakeVersion);
          continue;
        }
        await processTask(claimed);
      } catch (error) {
        logger.error('[MAIL_TASK_WORKER] loop failed', error);
        await waitForPoll(signal, observedWakeVersion);
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
