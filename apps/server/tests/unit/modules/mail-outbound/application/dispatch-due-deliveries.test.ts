import { describe, expect, it, vi } from 'vitest';

import { dispatchDueDeliveries } from '../../../../../src/modules/mail-outbound/application/dispatch-due-deliveries';

describe('dispatchDueDeliveries', () => {
  it('emits bounded non-authoritative wakeups in repository order', async () => {
    const enqueue = vi.fn();
    const result = await dispatchDueDeliveries(
      { now: new Date('2026-01-01T00:00:00.000Z'), limit: 2 },
      {
        unitOfWork: {
          run: async <Result>(
            operation: (tx: {
              outbound: {
                listDue: () => Promise<string[]>;
              };
            }) => Promise<Result>,
          ) =>
            operation({
              outbound: {
                listDue: async () => ['delivery-a', 'delivery-b'],
              },
            }),
        },
        wakeup: { enqueue },
      } as never,
    );

    expect(result).toEqual(['delivery-a', 'delivery-b']);
    expect(enqueue.mock.calls).toEqual([
      [{ type: 'deliver', deliveryId: 'delivery-a' }],
      [{ type: 'deliver', deliveryId: 'delivery-b' }],
    ]);
  });
});
