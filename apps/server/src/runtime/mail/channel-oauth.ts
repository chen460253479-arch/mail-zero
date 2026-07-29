import {
  ChannelOAuthService,
  channelOAuthRedirectUris,
  type ZeroOAuthChannelId,
} from '../../modules/mail-accounts/application/connect-channel-oauth';
import { readChannelOAuthProviderConfig } from '../../modules/mail-accounts/application/channel-oauth-provider-config';
import { provisionChannelMailboxInDatabase } from '../../modules/mail-accounts/runtime/provision-channel-mailbox';
import { createPostgresConnectionRepository } from '../../modules/mail-accounts/postgres/connection-repository';
import { normalizeMailboxEmail } from '../../modules/mail-accounts/application/mailbox-identity';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';
import { getMailOAuthGateway } from '../../mail-channel/oauth/providers';
import type { MailInboundRuntimeResources } from './inbound';
import type { DB } from '../../db';

const specs = {
  outlook: {
    channelId: 'outlook',
    providerKey: 'outlook',
    integrationKey: 'outlook_zero_oauth',
  },
  zoho_mail: {
    channelId: 'zoho_mail',
    providerKey: 'zoho_mail',
    integrationKey: 'zoho_mail_zero_oauth',
  },
} as const;

export const createChannelOAuthApplication = (
  db: DB,
  resources: MailInboundRuntimeResources,
  channelId: ZeroOAuthChannelId,
) => {
  const runtimeEnv = resources.environment;
  const repository = createSystemIntegrationRepository(db);
  return new ChannelOAuthService({
    spec: specs[channelId],
    repository,
    mailboxRepository: {
      save: async (userId, mailbox, authorization) => {
        const result = await createPostgresConnectionRepository(db).saveBinding({
          userId,
          existingMailboxId: null,
          mailbox: {
            ...mailbox,
            normalizedEmail: normalizeMailboxEmail(mailbox.email),
          },
          authorization,
        });
        await provisionChannelMailboxInDatabase(db, resources, {
          userId,
          connectionId: result.id,
          channelId,
          identity: {
            email: mailbox.email,
            name: mailbox.name,
          },
        });
        return result;
      },
    },
    gateway: getMailOAuthGateway(channelId),
    encryptionKey: runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
    redirectUris: channelOAuthRedirectUris(runtimeEnv.VITE_PUBLIC_BACKEND_URL, channelId),
    loadProviderConfig: () => readChannelOAuthProviderConfig(db, channelId),
    now: () => new Date(),
  });
};
