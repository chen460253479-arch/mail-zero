import { describe, expect, it, vi } from 'vitest';

import {
  deliverPendingEvent,
  type MailNotificationDeliveryRepository,
} from '../../../../src/modules/mail-notifications/application/deliver-pending';
import type { ClaimedMailNotification } from '../../../../src/modules/mail-notifications/domain/event';

const event: ClaimedMailNotification = {
  eventId: 'evt-1',
  messageId: 'email-1',
  accountId: 'account-1',
  kind: 'received',
  attempts: 1,
  leaseOwner: 'worker-1',
};

const createRepository = (): MailNotificationDeliveryRepository => ({
  complete: vi.fn(async () => true),
  scheduleRetry: vi.fn(async () => 'retry' as const),
});

describe('mail notification delivery', () => {
  it('posts only eventId and messageId', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 202 }));
    const repository = createRepository();

    await deliverPendingEvent(event, {
      webhookUrl: 'https://external.example.test/mail-events',
      fetch,
      repository,
      timeoutMs: 15_000,
      clock: {
        now: () => new Date('2026-07-29T10:00:00.000Z'),
      },
    });

    expect(fetch).toHaveBeenCalledWith('https://external.example.test/mail-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventId: 'evt-1',
        messageId: 'email-1',
      }),
      signal: expect.any(AbortSignal),
    });
  });

  it('keeps the same eventId when a non-2xx response is retried', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 503 }));
    const repository = createRepository();

    await expect(
      deliverPendingEvent(event, {
        webhookUrl: 'https://external.example.test/mail-events',
        fetch,
        repository,
        timeoutMs: 15_000,
        clock: {
          now: () => new Date('2026-07-29T10:00:00.000Z'),
        },
      }),
    ).rejects.toThrow('MAIL_NOTIFICATION_DELIVERY_FAILED');

    expect(repository.scheduleRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-1',
        owner: 'worker-1',
        runAt: new Date('2026-07-29T10:00:01.000Z'),
      }),
    );
  });

  it('does not add a signature or custom Zero header', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));

    await deliverPendingEvent(event, {
      webhookUrl: 'https://external.example.test/mail-events',
      fetch,
      repository: createRepository(),
      timeoutMs: 15_000,
      clock: {
        now: () => new Date('2026-07-29T10:00:00.000Z'),
      },
    });

    const request = fetch.mock.calls[0]![1]!;
    expect(request.headers).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('aborts a stalled delivery and schedules a retry', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason ?? new Error('aborted')),
            { once: true },
          );
        }),
    );
    const repository = createRepository();

    try {
      const delivery = deliverPendingEvent(event, {
        webhookUrl: 'https://external.example.test/mail-events',
        fetch,
        repository,
        clock: {
          now: () => new Date('2026-07-29T10:00:00.000Z'),
        },
        timeoutMs: 1_000,
      });
      const rejected = expect(delivery).rejects.toThrow('MAIL_NOTIFICATION_DELIVERY_FAILED');

      await vi.advanceTimersByTimeAsync(1_000);
      await rejected;

      expect(repository.scheduleRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt-1',
          owner: 'worker-1',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
