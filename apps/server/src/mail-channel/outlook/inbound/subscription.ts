import { MailSyncError, parseVersionedProviderState } from '../../../modules/mail-sync';
import type { InboundSubscriptionState } from '../../../modules/mail-sync';
import { OutlookApiError, outlookErrorStatus } from '../shared/errors';
import type { MicrosoftGraphClient } from '../shared/graph-client';

export type OutlookSubscriptionTarget = {
  notificationUrl: string;
  lifecycleNotificationUrl: string;
  clientState: string;
  encryptedClientState: string;
  expiresAt: Date;
  establishedAt: Date;
};

const requireWebhookUrl = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new MailSyncError('OUTLOOK_INVALID_SUBSCRIPTION_TARGET', 'permanent');
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.pathname !== '/api/webhooks/mail/outlook' ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      throw new Error('invalid');
    }
    return url.toString();
  } catch {
    throw new MailSyncError('OUTLOOK_INVALID_SUBSCRIPTION_TARGET', 'permanent');
  }
};

export const parseOutlookSubscriptionTarget = (value: unknown): OutlookSubscriptionTarget => {
  const target = parseVersionedProviderState(value);
  const expiresAt =
    typeof target.expiresAt === 'string' ? new Date(target.expiresAt) : new Date(Number.NaN);
  const establishedAt =
    typeof target.establishedAt === 'string'
      ? new Date(target.establishedAt)
      : new Date(Number.NaN);
  if (
    target.version !== 1 ||
    typeof target.clientState !== 'string' ||
    target.clientState.length < 32 ||
    target.clientState.length > 128 ||
    typeof target.encryptedClientState !== 'string' ||
    target.encryptedClientState.length === 0 ||
    Number.isNaN(expiresAt.getTime()) ||
    Number.isNaN(establishedAt.getTime()) ||
    expiresAt <= establishedAt
  ) {
    throw new MailSyncError('OUTLOOK_INVALID_SUBSCRIPTION_TARGET', 'permanent');
  }
  return {
    notificationUrl: requireWebhookUrl(target.notificationUrl),
    lifecycleNotificationUrl: requireWebhookUrl(target.lifecycleNotificationUrl),
    clientState: target.clientState,
    encryptedClientState: target.encryptedClientState,
    expiresAt,
    establishedAt,
  };
};

export const createOutlookSubscription = async (
  client: MicrosoftGraphClient,
  input: {
    notificationUrl: string;
    lifecycleNotificationUrl: string;
    clientState: string;
    encryptedClientState: string;
    expiresAt: Date;
    establishedAt: Date;
  },
  current?: InboundSubscriptionState,
): Promise<InboundSubscriptionState> => {
  if (current?.externalId && current.encryptedSecret && current.establishedAt) {
    try {
      const renewed = await client.renewInboxSubscription(current.externalId, input.expiresAt);
      const renewedExpiresAt = new Date(renewed.expiresAt);
      if (renewed.id !== current.externalId || Number.isNaN(renewedExpiresAt.getTime())) {
        throw new OutlookApiError('OUTLOOK_INVALID_SUBSCRIPTION_RESPONSE');
      }
      return {
        externalId: current.externalId,
        endpointTokenHash: null,
        encryptedSecret: current.encryptedSecret,
        expiresAt: renewedExpiresAt,
        establishedAt: current.establishedAt,
      };
    } catch (error) {
      const status = outlookErrorStatus(error);
      if (status !== 404 && status !== 410) throw error;
    }
  }
  const result = await client.createInboxSubscription({
    notificationUrl: input.notificationUrl,
    lifecycleNotificationUrl: input.lifecycleNotificationUrl,
    clientState: input.clientState,
    expiresAt: input.expiresAt,
  });
  const expiresAt = new Date(result.expiresAt);
  if (result.id.length === 0 || Number.isNaN(expiresAt.getTime())) {
    throw new OutlookApiError('OUTLOOK_INVALID_SUBSCRIPTION_RESPONSE');
  }
  return {
    externalId: result.id,
    endpointTokenHash: null,
    encryptedSecret: input.encryptedClientState,
    expiresAt,
    establishedAt: input.establishedAt,
  };
};
