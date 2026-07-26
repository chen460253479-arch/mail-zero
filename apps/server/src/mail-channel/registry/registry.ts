import type {
  MailCapability,
  MailChannelId,
  MailChannelInboundCapability,
  MailChannelOutboundCapability,
  MailChannelPlugin,
} from '../contracts';

export class UnsupportedMailChannelError extends Error {
  constructor(public readonly channelId: string) {
    super(`Unsupported mail channel: ${channelId}`);
    this.name = 'UnsupportedMailChannelError';
  }
}

export class MailChannelCapabilityError extends Error {
  constructor(
    public readonly channelId: string,
    public readonly capability: MailCapability | 'inbound' | 'outbound',
  ) {
    super(`Mail channel ${channelId} does not support ${capability}`);
    this.name = 'MailChannelCapabilityError';
  }
}

export type MailChannelRegistry = {
  list(): readonly MailChannelPlugin[];
  find(channelId: MailChannelId | (string & {})): MailChannelPlugin | undefined;
  get(channelId: MailChannelId | (string & {})): MailChannelPlugin;
  getInbound(channelId: MailChannelId | (string & {})): MailChannelInboundCapability;
  getOutbound(channelId: MailChannelId | (string & {})): MailChannelOutboundCapability;
};

export const createMailChannelRegistry = (
  plugins: readonly MailChannelPlugin[],
): MailChannelRegistry => {
  const channels = new Map<MailChannelId, MailChannelPlugin>();
  for (const plugin of plugins) {
    if (channels.has(plugin.id)) {
      throw new Error(`Mail channel is already registered: ${plugin.id}`);
    }
    channels.set(plugin.id, plugin);
  }

  const find = (channelId: MailChannelId | (string & {})): MailChannelPlugin | undefined =>
    channels.get(channelId as MailChannelId);
  const get = (channelId: MailChannelId | (string & {})): MailChannelPlugin => {
    const plugin = find(channelId);
    if (!plugin) throw new UnsupportedMailChannelError(channelId);
    return plugin;
  };

  return {
    list: () => [...channels.values()],
    find,
    get,
    getInbound: (channelId) => {
      const plugin = get(channelId);
      if (!plugin.inbound) {
        throw new MailChannelCapabilityError(plugin.id, 'inbound');
      }
      return plugin.inbound;
    },
    getOutbound: (channelId) => {
      const plugin = get(channelId);
      if (!plugin.outbound) {
        throw new MailChannelCapabilityError(plugin.id, 'outbound');
      }
      return plugin.outbound;
    },
  };
};
