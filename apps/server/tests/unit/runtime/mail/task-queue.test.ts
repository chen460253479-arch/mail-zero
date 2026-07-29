import { describe, expect, it, vi } from 'vitest';

import type { EnqueueMailTaskInput, MailTaskRepository } from '../../../../src/modules/mail-tasks';
import { createMailTaskQueuePort } from '../../../../src/runtime/mail/task-queue';

const createHarness = () => {
  const events: string[] = [];
  const enqueue = vi.fn(async (input: EnqueueMailTaskInput) => {
    events.push(`persist:${input.dedupeKey}`);
    return { id: `task-${events.length}`, created: true };
  });
  const repository = { enqueue } as unknown as MailTaskRepository;
  const notify = vi.fn(() => {
    events.push('notify');
  });
  return {
    port: createMailTaskQueuePort(repository, notify),
    enqueue,
    notify,
    events,
  };
};

describe('MailTaskQueuePort', () => {
  it('persists ingress commands with stable literal dedupe keys', async () => {
    const { port, enqueue } = createHarness();

    await port.enqueueIngress({
      type: 'signal',
      provider: 'gmail',
      externalAccount: 'owner@example.test',
      cursorHint: 'history-42',
    });
    await port.enqueueIngress({
      type: 'signal',
      provider: 'outlook',
      externalAccount: 'owner@example.test',
    });
    await port.enqueueIngress({ type: 'discover', syncId: 'sync-discover' });
    await port.enqueueIngress({ type: 'import', syncId: 'sync-import' });
    await port.enqueueIngress({ type: 'reconcile', syncId: 'sync-reconcile' });
    await port.enqueueIngress({ type: 'renew', syncId: 'sync-renew' });

    expect(enqueue.mock.calls.map(([input]) => input)).toEqual([
      {
        queue: 'ingress',
        command: {
          type: 'signal',
          provider: 'gmail',
          externalAccount: 'owner@example.test',
          cursorHint: 'history-42',
        },
        dedupeKey: 'ingress:signal:gmail:owner@example.test:history-42',
      },
      {
        queue: 'ingress',
        command: {
          type: 'signal',
          provider: 'outlook',
          externalAccount: 'owner@example.test',
        },
        dedupeKey: 'ingress:signal:outlook:owner@example.test:',
      },
      {
        queue: 'ingress',
        command: { type: 'discover', syncId: 'sync-discover' },
        dedupeKey: 'ingress:discover:sync-discover',
      },
      {
        queue: 'ingress',
        command: { type: 'import', syncId: 'sync-import' },
        dedupeKey: 'ingress:import:sync-import',
      },
      {
        queue: 'ingress',
        command: { type: 'reconcile', syncId: 'sync-reconcile' },
        dedupeKey: 'ingress:reconcile:sync-reconcile',
      },
      {
        queue: 'ingress',
        command: { type: 'renew', syncId: 'sync-renew' },
        dedupeKey: 'ingress:renew:sync-renew',
      },
    ]);
  });

  it('persists outbound commands with stable literal dedupe keys', async () => {
    const { port, enqueue } = createHarness();

    await port.enqueueOutbound({ type: 'dispatch' });
    await port.enqueueOutbound({ type: 'deliver', deliveryId: 'delivery-1' });
    await port.enqueueOutbound({ type: 'reconcile', deliveryId: 'delivery-2' });

    expect(enqueue.mock.calls.map(([input]) => input)).toEqual([
      {
        queue: 'outbound',
        command: { type: 'dispatch' },
        dedupeKey: 'outbound:dispatch',
      },
      {
        queue: 'outbound',
        command: { type: 'deliver', deliveryId: 'delivery-1' },
        dedupeKey: 'outbound:deliver:delivery-1',
      },
      {
        queue: 'outbound',
        command: { type: 'reconcile', deliveryId: 'delivery-2' },
        dedupeKey: 'outbound:reconcile:delivery-2',
      },
    ]);
  });

  it('notifies only after durable persistence succeeds', async () => {
    const { port, events, notify } = createHarness();

    await port.enqueueOutbound({ type: 'dispatch' });

    expect(events).toEqual(['persist:outbound:dispatch', 'notify']);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not notify when persistence fails', async () => {
    const repository = {
      enqueue: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    } as unknown as MailTaskRepository;
    const notify = vi.fn();
    const port = createMailTaskQueuePort(repository, notify);

    await expect(port.enqueueIngress({ type: 'discover', syncId: 'sync-1' })).rejects.toThrow(
      'database unavailable',
    );
    expect(notify).not.toHaveBeenCalled();
  });
});
