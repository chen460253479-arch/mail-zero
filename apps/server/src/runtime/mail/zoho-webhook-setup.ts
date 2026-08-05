import type { VersionedProviderState } from '../../modules/mail-sync';
import type { ZeroEnv } from '../../env';

export const createZohoWebhookSetup = (runtimeEnv: ZeroEnv): { webhookUrl: string } => ({
  webhookUrl: `${runtimeEnv.VITE_PUBLIC_BACKEND_URL.replace(/\/+$/u, '')}/api/webhooks/mail/zoho`,
});

export const createZohoSubscriptionTarget = (
  runtimeEnv: ZeroEnv,
  now: Date,
): VersionedProviderState => ({
  version: 1,
  notificationUrl: createZohoWebhookSetup(runtimeEnv).webhookUrl,
  establishedAt: now.toISOString(),
});
