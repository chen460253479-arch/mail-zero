import type { MailChannelCredentialContext } from './channel-credential-context';
import type { InboundMailAdapterFactory } from '../../modules/mail-sync';
import type { MailChannelRegistry } from '../../mail-channel/registry';

export const createChannelInboundAdapter = async (
  registry: MailChannelRegistry,
  context: MailChannelCredentialContext,
  connectionId: string,
) => {
  const inbound = registry.getInbound(context.channelId);
  return await inbound.createAdapter({
    connectionId,
    credential: await context.resolveCredential(false),
  });
};

export const createChannelInboundAdapterFactory = (
  registry: MailChannelRegistry,
  resolveContext: (connectionId: string) => Promise<MailChannelCredentialContext>,
): InboundMailAdapterFactory => ({
  create: async (connectionId) =>
    await createChannelInboundAdapter(registry, await resolveContext(connectionId), connectionId),
});
