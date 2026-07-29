import {
  defaultZohoMailChannelConfig,
  parseZohoMailChannelConfig,
} from '../../../mail-channel/zoho-mail/config';
import {
  defaultOutlookChannelConfig,
  parseOutlookChannelConfig,
} from '../../../mail-channel/outlook/config';
import { createChannelConfigRepository } from '../../../integrations/core/channel-config-repository';
import type { ZeroOAuthChannelId } from './connect-channel-oauth';
import type { DB } from '../../../db';

export const readChannelOAuthProviderConfig = async (
  db: DB,
  channelId: ZeroOAuthChannelId,
): Promise<Record<string, unknown>> => {
  const record = await createChannelConfigRepository(db).get(channelId);
  if (channelId === 'outlook') {
    if (record === null) return defaultOutlookChannelConfig.providerConfig;
    return parseOutlookChannelConfig({
      channelId,
      authSource: record.authSource,
      inboxWatchEnabled: record.inboxWatchEnabled,
      scheduledSyncEnabled: record.scheduledSyncEnabled,
      syncIntervalMinutes: record.syncIntervalMinutes,
      providerConfig: record.providerConfig,
    }).providerConfig;
  }
  if (record === null) return defaultZohoMailChannelConfig.providerConfig;
  return parseZohoMailChannelConfig({
    channelId,
    authSource: record.authSource,
    inboxWatchEnabled: record.inboxWatchEnabled,
    scheduledSyncEnabled: record.scheduledSyncEnabled,
    syncIntervalMinutes: record.syncIntervalMinutes,
    providerConfig: record.providerConfig,
  }).providerConfig;
};
