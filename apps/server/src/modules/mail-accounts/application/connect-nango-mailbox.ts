import {
  bindNangoMailbox,
  NangoBindingError,
  type BindNangoMailboxInput,
} from './bind-nango-mailbox';
import { createChannelConfigRepository } from '../../../integrations/core/channel-config-repository';
import { createIdentityMailChannelRegistry } from '../../../runtime/mail/channel-registry';
import { provisionChannelMailboxInDatabase } from '../runtime/provision-channel-mailbox';
import { createPostgresConnectionRepository } from '../postgres/connection-repository';
import { NangoIntegrationError } from '../../../integrations/nango/errors';
import type { RuntimeServices } from '../../../runtime/node/services';
import type { MailChannelId } from '../../../mail-channel/contracts';

export type ConnectNangoMailboxInput = {
  userId: string;
  channelId: MailChannelId;
  connectionId: string;
};

type ConnectedNangoMailbox = {
  id: string;
  identity: {
    email: string;
    name: string;
    picture: string;
  };
};

export type ConnectNangoMailboxDependencies = {
  assertNangoChannelAvailable(channelId: MailChannelId): Promise<string>;
  bind(input: BindNangoMailboxInput): Promise<ConnectedNangoMailbox>;
  provision(input: {
    userId: string;
    connectionId: string;
    channelId: MailChannelId;
    identity: ConnectedNangoMailbox['identity'];
  }): Promise<unknown>;
};

const createRuntimeDependencies = (services: RuntimeServices): ConnectNangoMailboxDependencies => {
  const db = services.database.db;
  const connectionRepository = createPostgresConnectionRepository(db);
  const channels = createIdentityMailChannelRegistry(db, services.environment);

  return {
    assertNangoChannelAvailable: async (channelId) => {
      const channelConfig = await createChannelConfigRepository(db).get(channelId);
      if (channelConfig?.authSource !== 'nango') {
        throw new NangoBindingError('MAIL_CHANNEL_UNAVAILABLE');
      }
      try {
        return await services.nangoChannels.requireIntegrationKey(channelId);
      } catch (error) {
        if (error instanceof NangoIntegrationError) {
          throw new NangoBindingError('MAIL_CHANNEL_UNAVAILABLE');
        }
        throw error;
      }
    },
    bind: async (input) =>
      await bindNangoMailbox(input, {
        client: services.nango,
        getChannel: (channelId) => channels.get(channelId),
        isIntegrationAvailable: async (channelId, integrationId) => {
          try {
            return (
              (await services.nangoChannels.requireIntegrationKey(channelId)) === integrationId
            );
          } catch (error) {
            if (error instanceof NangoIntegrationError) return false;
            throw error;
          }
        },
        repository: {
          findMailboxByNormalizedEmail: (userId, channelId, normalizedEmail) =>
            connectionRepository.findMailboxByNormalizedEmail(userId, channelId, normalizedEmail),
          findByNangoReference: (integrationId, connectionId) =>
            connectionRepository.findByNangoReference(integrationId, connectionId),
          save: (bindingInput) =>
            connectionRepository.saveBinding({
              userId: input.userId,
              ...bindingInput,
            }),
        },
        encryptionKey: services.config.credentialEncryptionKey,
        now: () => new Date(),
      }),
    provision: async (input) => await provisionChannelMailboxInDatabase(db, services, input),
  };
};

export const connectNangoMailbox = async (
  input: ConnectNangoMailboxInput,
  services: RuntimeServices,
  dependencies: ConnectNangoMailboxDependencies = createRuntimeDependencies(services),
): Promise<{ id: string }> => {
  const integrationId = await dependencies.assertNangoChannelAvailable(input.channelId);
  const binding = await dependencies.bind({
    ...input,
    integrationId,
  });
  await dependencies.provision({
    userId: input.userId,
    connectionId: binding.id,
    channelId: input.channelId,
    identity: binding.identity,
  });
  return { id: binding.id };
};
