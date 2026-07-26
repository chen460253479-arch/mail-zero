import type { MailboxChannel, MailChannelId, MailCredentialType } from './types';
import { gmailChannel } from './gmail';

const channels = new Map<MailChannelId, MailboxChannel>([['gmail', gmailChannel]]);

export const listMailChannels = () => Array.from(channels.values());

export const getMailChannel = (id: MailChannelId | (string & {})): MailboxChannel => {
  const channel = channels.get(id as MailChannelId);
  if (!channel) throw new Error(`Unsupported mail channel: ${id}`);
  return channel;
};

export const providerIdToChannelId = (providerId: string): MailChannelId => {
  if (providerId === 'google') return 'gmail';
  if (providerId === 'microsoft') return 'outlook';
  throw new Error(`Unsupported provider: ${providerId}`);
};

export const channelIdToProviderId = (
  channelId: MailChannelId | (string & {}),
): 'google' | 'microsoft' => {
  const providerId = getMailChannel(channelId).legacyProviderId;
  if (!providerId) throw new Error(`Mail channel has no legacy provider mapping: ${channelId}`);
  return providerId;
};

export const assertMailChannelBinding = (input: {
  channelId: MailChannelId;
  providerKey: string;
  credentialType: MailCredentialType;
}): void => {
  const channel = getMailChannel(input.channelId);
  if (channel.providerKey !== input.providerKey) {
    throw new Error('MAIL_CHANNEL_PROVIDER_MISMATCH');
  }
  if (!channel.credentialTypes.has(input.credentialType)) {
    throw new Error('MAIL_CHANNEL_CREDENTIAL_UNSUPPORTED');
  }
};
