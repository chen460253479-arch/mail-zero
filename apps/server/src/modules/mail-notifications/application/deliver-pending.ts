import type { ClaimedMailNotification } from '../domain/event';

export const MAIL_NOTIFICATION_RETRY_BASE_DELAY_MS = 1_000;
export const MAIL_NOTIFICATION_MAX_RETRY_DELAY_MS = 15 * 60_000;

export interface MailNotificationDeliveryRepository {
  complete(input: { eventId: string; owner: string }): Promise<boolean>;
  scheduleRetry(input: {
    eventId: string;
    owner: string;
    now: Date;
    runAt: Date;
    errorMessage: string;
  }): Promise<'retry' | 'dead' | 'lost'>;
}

type DeliverPendingEventDependencies = {
  webhookUrl: string;
  fetch: typeof fetch;
  repository: MailNotificationDeliveryRepository;
  signal?: AbortSignal;
  timeoutMs: number;
  clock: {
    now(): Date;
  };
};

const retryAt = (now: Date, attempts: number): Date => {
  const exponent = Math.max(0, Math.min(30, attempts - 1));
  const delay = Math.min(
    MAIL_NOTIFICATION_MAX_RETRY_DELAY_MS,
    MAIL_NOTIFICATION_RETRY_BASE_DELAY_MS * 2 ** exponent,
  );
  return new Date(now.getTime() + delay);
};

export const deliverPendingEvent = async (
  event: ClaimedMailNotification,
  dependencies: DeliverPendingEventDependencies,
): Promise<void> => {
  if (!Number.isSafeInteger(dependencies.timeoutMs) || dependencies.timeoutMs < 1) {
    throw new Error('MAIL_NOTIFICATION_DELIVERY_INVALID_TIMEOUT_MS');
  }

  const controller = new AbortController();
  const abortFromWorker = () => controller.abort(dependencies.signal?.reason);
  if (dependencies.signal?.aborted) {
    abortFromWorker();
  } else {
    dependencies.signal?.addEventListener('abort', abortFromWorker, { once: true });
  }
  const timeout = setTimeout(
    () => controller.abort(new Error('MAIL_NOTIFICATION_DELIVERY_TIMEOUT')),
    dependencies.timeoutMs,
  );

  try {
    const response = await dependencies.fetch(dependencies.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventId: event.eventId,
        messageId: event.messageId,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`MAIL_NOTIFICATION_DELIVERY_FAILED:${response.status}`);
    }
    await dependencies.repository.complete({
      eventId: event.eventId,
      owner: event.leaseOwner,
    });
  } catch (error) {
    const now = dependencies.clock.now();
    await dependencies.repository.scheduleRetry({
      eventId: event.eventId,
      owner: event.leaseOwner,
      now,
      runAt: retryAt(now, event.attempts),
      errorMessage:
        error instanceof Error
          ? error.message.slice(0, 2_048)
          : 'MAIL_NOTIFICATION_DELIVERY_FAILED',
    });
    const cause = error instanceof Error ? error : undefined;
    throw new Error('MAIL_NOTIFICATION_DELIVERY_FAILED', { cause });
  } finally {
    clearTimeout(timeout);
    dependencies.signal?.removeEventListener('abort', abortFromWorker);
  }
};
