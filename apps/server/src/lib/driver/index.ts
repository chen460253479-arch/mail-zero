import type { MailManager, ManagerConfig } from './types';
import { getMailChannel, providerIdToChannelId } from '../mail-channel/registry';
import type { MailChannelId } from '../mail-channel/types';

export const createDriver = (
  provider: MailChannelId | 'google' | 'microsoft' | (string & {}),
  config: ManagerConfig,
): MailManager => {
  const channelId =
    provider === 'google' || provider === 'microsoft'
      ? providerIdToChannelId(provider)
      : provider;
  return getMailChannel(channelId).createClient(config);
};
