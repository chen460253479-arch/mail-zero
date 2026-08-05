import { z } from 'zod';

import type { VersionedProviderState } from '../../../modules/mail-sync/domain/sync-state';
import type { InboundSubscriptionState } from '../../../modules/mail-sync';

const targetSchema = z.object({
  version: z.literal(1),
  notificationUrl: z.string().url(),
  establishedAt: z.string().datetime(),
});

export const parseZohoMailSubscriptionTarget = (value: VersionedProviderState) => {
  const target = targetSchema.parse(value);
  const url = new URL(target.notificationUrl);
  if (
    url.protocol !== 'https:' ||
    url.pathname !== '/api/webhooks/mail/zoho' ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error('ZOHO_WEBHOOK_TARGET_INVALID');
  }
  return target;
};

export const createZohoMailSubscription = (
  target: ReturnType<typeof parseZohoMailSubscriptionTarget>,
): InboundSubscriptionState => ({
  expiresAt: null,
  externalId: null,
  endpointTokenHash: null,
  encryptedSecret: null,
  establishedAt: new Date(target.establishedAt),
});
