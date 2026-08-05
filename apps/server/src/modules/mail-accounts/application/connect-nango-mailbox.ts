import {
  createPostgresConnectionRepository,
  MailConnectionRepositoryError,
} from '../postgres/connection-repository';
import {
  bindNangoMailbox,
  NangoBindingError,
  type BindNangoMailboxInput,
} from './bind-nango-mailbox';
import { createChannelConfigRepository } from '../../../integrations/core/channel-config-repository';
import type { MailChannelExternalData, MailChannelId } from '../../../mail-channel/contracts';
import { createIdentityMailChannelRegistry } from '../../../runtime/mail/channel-registry';
import { provisionChannelMailboxInDatabase } from '../runtime/provision-channel-mailbox';
import { NangoIntegrationError } from '../../../integrations/nango/errors';
import type { RuntimeServices } from '../../../runtime/node/services';
import { resolveFetchedNangoCredential } from '../credentials/nango';

export type ConnectNangoMailboxInput = {
  userId: string;
  channelId: MailChannelId;
  connectionId: string;
  externalData?: MailChannelExternalData;
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
  reserve(input: {
    userId: string;
    channelId: 'zoho_mail';
    connectionId: string;
    integrationId: string;
  }): Promise<{ id: string }>;
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
    reserve: async (input) => {
      let channel;
      try {
        channel = channels.get(input.channelId);
      } catch {
        throw new NangoBindingError('MAIL_CHANNEL_UNAVAILABLE');
      }
      const connection = await services.nango
        .getConnection(input.connectionId, input.integrationId)
        .catch(() => {
          throw new NangoBindingError('NANGO_CONNECTION_INVALID');
        });
      if (
        connection.connection_id !== input.connectionId ||
        connection.provider_config_key !== input.integrationId ||
        !channel.nangoProviders?.includes(connection.provider)
      ) {
        throw new NangoBindingError('NANGO_CONNECTION_INVALID');
      }
      let credentialType;
      try {
        credentialType = resolveFetchedNangoCredential(
          connection.credentials,
          connection.connection_config,
        ).credential.type;
      } catch {
        throw new NangoBindingError('NANGO_CONNECTION_INVALID');
      }
      if (!channel.credentialTypes.has(credentialType)) {
        throw new NangoBindingError('MAIL_CHANNEL_UNAVAILABLE');
      }
      try {
        return await connectionRepository.reservePendingNangoBinding({
          userId: input.userId,
          channelId: input.channelId,
          providerConfigKey: input.integrationId,
          nangoConnectionId: input.connectionId,
        });
      } catch (error) {
        if (
          error instanceof MailConnectionRepositoryError &&
          error.code === 'NANGO_CONNECTION_ALREADY_BOUND'
        ) {
          throw new NangoBindingError(error.code);
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
          findPendingByNangoReference: (integrationId, connectionId) =>
            connectionRepository.findPendingByNangoReference(integrationId, connectionId),
          updateExternalData: ({ connectionId, externalData }) =>
            connectionRepository.updateAuthorizationExternalData(
              input.userId,
              connectionId,
              externalData,
            ),
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
  if (input.channelId === 'zoho_mail' && input.externalData === undefined) {
    return await dependencies.reserve({
      userId: input.userId,
      channelId: input.channelId,
      connectionId: input.connectionId,
      integrationId,
    });
  }
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
