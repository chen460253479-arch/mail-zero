import { fromByteArray } from 'base64-js';

import type { VersionedProviderState } from '../../modules/mail-sync';
import type { ZeroEnv } from '../../env';

const base64Url = (value: Uint8Array): string =>
  fromByteArray(value).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');

const hmac = async (keyMaterial: string, value: string): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keyMaterial),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
};

const digestHex = async (value: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

export const createZohoWebhookSetup = async (
  runtimeEnv: ZeroEnv,
  accountId: string,
): Promise<{ endpointToken: string; endpointTokenHash: string; webhookUrl: string }> => {
  const endpointToken = base64Url(
    await hmac(runtimeEnv.CREDENTIAL_ENCRYPTION_KEY, `zoho-mail-webhook:endpoint:${accountId}`),
  );
  return {
    endpointToken,
    endpointTokenHash: await digestHex(endpointToken),
    webhookUrl: `${runtimeEnv.VITE_PUBLIC_BACKEND_URL.replace(/\/+$/u, '')}/api/webhooks/mail/zoho/${endpointToken}`,
  };
};

export const createZohoSubscriptionTarget = async (
  runtimeEnv: ZeroEnv,
  accountId: string,
  now: Date,
): Promise<VersionedProviderState> => {
  const setup = await createZohoWebhookSetup(runtimeEnv, accountId);
  return {
    version: 1,
    notificationUrl: setup.webhookUrl,
    endpointTokenHash: setup.endpointTokenHash,
    establishedAt: now.toISOString(),
  };
};
