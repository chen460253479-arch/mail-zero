import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMailScheduler, type MailTaskRepository } from '../../../../src/modules/mail-tasks';

const now = new Date('2026-07-29T00:00:00.000Z');

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const createScheduler = (overrides: Partial<Parameters<typeof createMailScheduler>[0]> = {}) => {
  const repository = {
    recoverExpired: vi.fn(async () => 0),
  } as unknown as MailTaskRepository;
  const dependencies: Parameters<typeof createMailScheduler>[0] = {
    repository,
    enqueueDueIngress: vi.fn(async () => undefined),
    enqueueDueOutbound: vi.fn(async () => undefined),
    wakeDueSnoozes: vi.fn(async () => undefined),
    intervalMs: 1_000,
    expiredRecoveryLimit: 100,
    clock: { now: () => new Date(now) },
    logger: { error: vi.fn() },
    ...overrides,
  };
  return {
    scheduler: createMailScheduler(dependencies),
    dependencies,
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('MailScheduler', () => {
  it('runs every due-work scan and expired task recovery once per tick', async () => {
    const { scheduler, dependencies } = createScheduler();

    await scheduler.tick();

    expect(dependencies.enqueueDueIngress).toHaveBeenCalledTimes(1);
    expect(dependencies.enqueueDueOutbound).toHaveBeenCalledTimes(1);
    expect(dependencies.wakeDueSnoozes).toHaveBeenCalledTimes(1);
    expect(dependencies.repository.recoverExpired).toHaveBeenCalledWith({
      now,
      limit: 100,
    });
  });

  it('coalesces overlapping ticks instead of running scans concurrently', async () => {
    const gate = deferred();
    const enqueueDueIngress = vi.fn(() => gate.promise);
    const { scheduler, dependencies } = createScheduler({ enqueueDueIngress });

    const first = scheduler.tick();
    const overlapping = scheduler.tick();
    await Promise.resolve();

    expect(enqueueDueIngress).toHaveBeenCalledTimes(1);
    expect(dependencies.enqueueDueOutbound).toHaveBeenCalledTimes(1);
    gate.resolve();
    await Promise.all([first, overlapping]);
  });

  it('logs an isolated scan failure and allows later ticks to run', async () => {
    const enqueueDueIngress = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('first tick failed'))
      .mockResolvedValue(undefined);
    const { scheduler, dependencies } = createScheduler({ enqueueDueIngress });

    await scheduler.tick();
    await scheduler.tick();

    expect(enqueueDueIngress).toHaveBeenCalledTimes(2);
    expect(dependencies.enqueueDueOutbound).toHaveBeenCalledTimes(2);
    expect(dependencies.logger!.error).toHaveBeenCalledWith(
      '[MAIL_SCHEDULER] ingress scan failed',
      expect.any(Error),
    );
  });

  it('clears its timer and waits for the current tick during stop', async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const enqueueDueIngress = vi.fn(() => gate.promise);
    const { scheduler } = createScheduler({ enqueueDueIngress, intervalMs: 100 });

    scheduler.start();
    await Promise.resolve();
    expect(enqueueDueIngress).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(stopped).toBe(false);
    expect(enqueueDueIngress).toHaveBeenCalledTimes(1);

    gate.resolve();
    await stopping;
    expect(stopped).toBe(true);
  });
});
