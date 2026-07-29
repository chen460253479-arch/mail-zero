import { describe, expect, it, vi } from 'vitest';

import { createMailNotificationWorker } from '../../../../src/modules/mail-notifications/runtime/worker';
import type { ClaimedMailNotification } from '../../../../src/modules/mail-notifications/domain/event';

const event: ClaimedMailNotification = {
  eventId: 'evt-1',
  messageId: 'email-1',
  accountId: 'account-1',
  kind: 'received',
  attempts: 1,
  leaseOwner: 'worker-1',
};

describe('mail notification worker', () => {
  it('claims and delivers a pending event', async () => {
    const claim = vi.fn().mockResolvedValueOnce([event]).mockResolvedValue([]);
    const deliver = vi.fn(async () => undefined);
    const worker = createMailNotificationWorker({
      repository: {
        claim,
      },
      deliver,
      concurrency: 1,
      pollIntervalMs: 10,
      leaseForMs: 60_000,
      clock: {
        now: () => new Date('2026-07-29T10:00:00.000Z'),
      },
      newOwner: () => 'worker-1',
      logger: {
        error: vi.fn(),
      },
    });

    worker.start();
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledWith(event));
    await worker.stop();
  });
});
