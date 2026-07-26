import { describe, expect, it, vi } from 'vitest';

import { createMailOutboundRuntime } from './create-mail-outbound';

const now = new Date('2026-01-01T00:00:00.000Z');

const createDependencies = () => {
  const claimById = vi.fn();
  const listDue = vi.fn(async () => ['delivery-due']);
  const listDueUncertain = vi.fn(async () => ['delivery-uncertain']);
  const recoverExpiredLeases = vi.fn(async () => ['delivery-expired']);
  const enqueue = vi.fn(async () => undefined);
  const deliverClaimed = vi.fn(async () => 'sent' as const);
  const reconcileUncertain = vi.fn(async () => 'sent' as const);
  const tx = {
    outbound: {
      claimById,
      listDue,
      listDueUncertain,
      recoverExpiredLeases,
    },
  };

  return {
    values: {
      claimById,
      enqueue,
      deliverClaimed,
      reconcileUncertain,
    },
    dependencies: {
      unitOfWork: {
        run: async <Result>(operation: (transaction: typeof tx) => Promise<Result>) =>
          await operation(tx),
      },
      mailCoreDependencies: {} as never,
      blobStore: {} as never,
      credentialResolver: {} as never,
      registry: {} as never,
      connectionState: {} as never,
      wakeup: { enqueue },
      clock: { now: () => now },
      nextId: () => 'delivery-new',
      newLeaseOwner: () => 'worker-a',
      leaseForMs: 60_000,
      scanLimit: 100,
      jitter: () => 0,
      operations: {
        enqueueSubmission: vi.fn(),
        deliverClaimed,
        reconcileUncertain,
        finalizeAccepted: vi.fn(),
        finalizeFailed: vi.fn(),
      },
    },
  };
};

describe('createMailOutboundRuntime', () => {
  it('absorbs duplicate delivery wakeups when only one lease can be claimed', async () => {
    const { dependencies, values } = createDependencies();
    const claimed = { delivery: { id: 'delivery-a' } };
    values.claimById.mockResolvedValueOnce(claimed).mockResolvedValueOnce(null);
    const runtime = createMailOutboundRuntime(dependencies as never);

    await runtime.process({ type: 'deliver', deliveryId: 'delivery-a' });
    await runtime.process({ type: 'deliver', deliveryId: 'delivery-a' });

    expect(values.claimById).toHaveBeenCalledTimes(2);
    expect(values.deliverClaimed).toHaveBeenCalledTimes(1);
    expect(values.deliverClaimed).toHaveBeenCalledWith(claimed, expect.any(Object));
  });

  it('repairs lost wakeups by scanning send, uncertain, and expired work separately', async () => {
    const { dependencies, values } = createDependencies();
    const runtime = createMailOutboundRuntime(dependencies as never);

    await expect(runtime.enqueueDue()).resolves.toEqual({
      due: 1,
      uncertain: 1,
      expired: 1,
    });
    expect(values.enqueue.mock.calls).toEqual([
      [{ type: 'deliver', deliveryId: 'delivery-due' }],
      [{ type: 'reconcile', deliveryId: 'delivery-uncertain' }],
      [{ type: 'reconcile', deliveryId: 'delivery-expired' }],
    ]);
  });

  it('routes reconciliation commands without acquiring a send lease', async () => {
    const { dependencies, values } = createDependencies();
    const runtime = createMailOutboundRuntime(dependencies as never);

    await runtime.process({ type: 'reconcile', deliveryId: 'delivery-a' });

    expect(values.claimById).not.toHaveBeenCalled();
    expect(values.reconcileUncertain).toHaveBeenCalledWith(
      {
        deliveryId: 'delivery-a',
        owner: 'worker-a',
        leaseForMs: 60_000,
      },
      expect.any(Object),
    );
  });
});
