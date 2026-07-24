import { gmailChannel } from './gmail';
import type { MailboxChannel, MailChannelId } from './types';

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
