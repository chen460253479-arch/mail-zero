import type { OutboundAttemptKind } from './delivery';

export const SEND_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000] as const;
export const RECONCILIATION_DELAYS_MS = [30_000, 120_000, 600_000] as const;
export const MAX_PROVIDER_RETRY_AFTER_MS = 86_400_000;
export const MAX_RETRY_JITTER_RATIO = 0.2;

export type NextOutboundRetryAtInput = {
  now: Date;
  attemptNumber: number;
  kind: OutboundAttemptKind;
  providerRetryAfter: Date | null;
  jitter: () => number;
};

const validProviderDelay = (now: Date, retryAfter: Date | null): number | null => {
  if (retryAfter === null || !Number.isFinite(retryAfter.getTime())) {
    return null;
  }
  const delay = retryAfter.getTime() - now.getTime();
  return delay > 0 && delay <= MAX_PROVIDER_RETRY_AFTER_MS ? delay : null;
};

export const nextOutboundRetryAt = (input: NextOutboundRetryAtInput): Date | null => {
  const schedule = input.kind === 'send' ? SEND_RETRY_DELAYS_MS : RECONCILIATION_DELAYS_MS;
  const scheduledDelay = schedule[input.attemptNumber - 1];
  if (scheduledDelay === undefined || !Number.isFinite(input.now.getTime())) {
    return null;
  }
  const baseDelay = validProviderDelay(input.now, input.providerRetryAfter) ?? scheduledDelay;
  const sampledJitter = input.jitter();
  const jitterValue = Number.isFinite(sampledJitter) ? Math.max(-1, Math.min(1, sampledJitter)) : 0;
  const jitteredDelay = Math.round(baseDelay * (1 + MAX_RETRY_JITTER_RATIO * jitterValue));
  const boundedDelay = Math.max(1, Math.min(MAX_PROVIDER_RETRY_AFTER_MS, jitteredDelay));
  return new Date(input.now.getTime() + boundedDelay);
};
