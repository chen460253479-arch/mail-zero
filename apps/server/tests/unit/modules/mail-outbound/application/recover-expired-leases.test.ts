import { describe, expect, it, vi } from 'vitest';

import { recoverExpiredOutboundLeases } from '../../../../../src/modules/mail-outbound/application/recover-expired-leases';

describe('recoverExpiredOutboundLeases', () => {
  it('emits reconciliation commands for recovered send leases', async () => {
    const enqueue = vi.fn();
    await expect(
      recoverExpiredOutboundLeases(
        {
          now: new Date('2026-01-01T00:01:00.000Z'),
          limit: 10,
        },
        {
          unitOfWork: {
            run: async <Result>(
              operation: (tx: {
                outbound: {
                  recoverExpiredLeases: () => Promise<string[]>;
                };
              }) => Promise<Result>,
            ): Promise<Result> =>
              operation({
                outbound: {
                  recoverExpiredLeases: async () => ['delivery-a', 'delivery-b'],
                },
              }),
          },
          wakeup: { enqueue },
        } as never,
      ),
    ).resolves.toEqual(['delivery-a', 'delivery-b']);
    expect(enqueue.mock.calls).toEqual([
      [{ type: 'reconcile', deliveryId: 'delivery-a' }],
      [{ type: 'reconcile', deliveryId: 'delivery-b' }],
    ]);
  });
});
