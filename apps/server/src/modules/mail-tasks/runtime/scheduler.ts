import type { MailTaskRepository } from '../domain/task';

export type MailScheduler = {
  start(): void;
  stop(): Promise<void>;
  tick(): Promise<void>;
};

type MailSchedulerLogger = {
  error(message: string, error: unknown): void;
};

export type CreateMailSchedulerDependencies = {
  repository: Pick<MailTaskRepository, 'recoverExpired'>;
  enqueueDueIngress(): Promise<unknown>;
  enqueueDueOutbound(): Promise<unknown>;
  wakeDueSnoozes(): Promise<unknown>;
  intervalMs: number;
  expiredRecoveryLimit: number;
  clock: { now(): Date };
  logger?: MailSchedulerLogger;
};

const requirePositiveInteger = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`MAIL_SCHEDULER_INVALID_${name}`);
  }
};

export const createMailScheduler = (
  dependencies: CreateMailSchedulerDependencies,
): MailScheduler => {
  requirePositiveInteger('INTERVAL_MS', dependencies.intervalMs);
  requirePositiveInteger('EXPIRED_RECOVERY_LIMIT', dependencies.expiredRecoveryLimit);

  const logger = dependencies.logger ?? console;
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentTick: Promise<void> | null = null;

  const runTick = async (): Promise<void> => {
    const now = dependencies.clock.now();
    const scans = [
      ['ingress scan', () => dependencies.enqueueDueIngress()],
      ['outbound scan', () => dependencies.enqueueDueOutbound()],
      ['snooze scan', () => dependencies.wakeDueSnoozes()],
      [
        'expired task recovery',
        () =>
          dependencies.repository.recoverExpired({
            now,
            limit: dependencies.expiredRecoveryLimit,
          }),
      ],
    ] as const;
    const results = await Promise.allSettled(scans.map(([, scan]) => Promise.resolve().then(scan)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.error(`[MAIL_SCHEDULER] ${scans[index]![0]} failed`, result.reason);
      }
    });
  };

  const tick = (): Promise<void> => {
    if (currentTick !== null) return currentTick;
    const running = runTick();
    const tracked = running.finally(() => {
      if (currentTick === tracked) currentTick = null;
    });
    currentTick = tracked;
    return tracked;
  };

  return {
    start() {
      if (timer !== null) return;
      void tick();
      timer = setInterval(() => {
        void tick();
      }, dependencies.intervalMs);
    },

    async stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      await currentTick;
    },

    tick,
  };
};
