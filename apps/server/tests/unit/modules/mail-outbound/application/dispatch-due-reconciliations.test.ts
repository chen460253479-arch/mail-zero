import { describe, expect, it, vi } from 'vitest';

import { dispatchDueReconciliations } from '../../../../../src/modules/mail-outbound/application/dispatch-due-reconciliations';

describe('dispatchDueReconciliations', () => {
  it('emits only reconciliation wakeups in repository order', async () => {
    const enqueue = vi.fn();
    const result = await dispatchDueReconciliations(
      { now: new Date('2026-01-01T00:00:00.000Z'), limit: 2 },
      {
        unitOfWork: {
          run: async <Result>(
            operation: (tx: {
              outbound: {
                listDueUncertain: () => Promise<string[]>;
              };
            }) => Promise<Result>,
          ) =>
            operation({
              outbound: {
                listDueUncertain: async () => ['delivery-a', 'delivery-b'],
              },
            }),
        },
        wakeup: { enqueue },
      } as never,
    );

    expect(result).toEqual(['delivery-a', 'delivery-b']);
    expect(enqueue.mock.calls).toEqual([
      [{ type: 'reconcile', deliveryId: 'delivery-a' }],
      [{ type: 'reconcile', deliveryId: 'delivery-b' }],
    ]);
  });
});
