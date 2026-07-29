import {
  readChannelOAuthRuntimeConfig,
  type ZeroOAuthChannelId,
} from '../application/connect-channel-oauth';
import { createMailChannelCredentialContext } from '../../../runtime/mail/channel-credential-context';
import { GoogleGmailOAuthGateway } from '../../../mail-channel/gmail/auth/google-oauth-gateway';
import { createGmailCredentialContext } from '../../../runtime/mail/gmail-credential-context';
import { readChannelOAuthProviderConfig } from '../application/channel-oauth-provider-config';
import { createPostgresMailSyncRepository } from '../../mail-sync/postgres/sync-repository';
import { createSystemIntegrationRepository } from '../../../integrations/core/repository';
import { createPostgresConnectionRepository } from '../postgres/connection-repository';
import { stopOutlookWatchForConnection } from '../../../runtime/mail/outlook-watch';
import { stopGmailWatchForConnection } from '../../../runtime/mail/gmail-inbound';
import { readGmailOAuthRuntimeConfig } from '../application/connect-gmail-oauth';
import type { MailInboundRuntimeResources } from '../../../runtime/mail/inbound';
import { getMailOAuthGateway } from '../../../mail-channel/oauth/providers';
import { createMailboxLifecycleRuntime } from './lifecycle';
import { parseObjectKey } from '../../mail/blob/blob-key';
import type { DB } from '../../../db';

const safeErrorName = (error: unknown): string =>
  error instanceof Error ? error.name : 'UnknownError';

export const createMailboxLifecycleForDatabase = (
  db: DB,
  resources: MailInboundRuntimeResources,
) => {
  const runtimeEnv = resources.environment;
  const repository = createPostgresConnectionRepository(db);
  const syncRepository = createPostgresMailSyncRepository(db);

  return createMailboxLifecycleRuntime({
    repository,
    pauseConnectionSyncs: (input) => syncRepository.pauseConnectionSyncs(input),
    stopChannelWatch: async (mailConnection) => {
      if (mailConnection.channelId === 'gmail') {
        await stopGmailWatchForConnection(db, resources, mailConnection.id);
      } else if (mailConnection.channelId === 'outlook') {
        await stopOutlookWatchForConnection(db, resources, mailConnection.id);
      }
    },
    revokeZeroOAuth: async (mailConnection) => {
      const connectionId = mailConnection.id;
      const channelId = mailConnection.channelId;
      const credential =
        channelId === 'gmail'
          ? await (
              await createGmailCredentialContext(db, resources, connectionId)
            ).resolveCredential(false)
          : await (
              await createMailChannelCredentialContext(db, resources, connectionId)
            ).resolveCredential(false);
      if (credential.type !== 'oauth2') {
        throw new Error('Zero OAuth credential is not OAuth2');
      }
      if (channelId === 'gmail') {
        const config = await readGmailOAuthRuntimeConfig({
          repository: createSystemIntegrationRepository(db),
          encryptionKey: runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
          redirectUri: `${runtimeEnv.VITE_PUBLIC_BACKEND_URL.replace(/\/+$/u, '')}/api/integrations/gmail/connect/callback`,
        });
        await new GoogleGmailOAuthGateway().revokeToken(
          config,
          credential.refreshToken ?? credential.accessToken,
        );
        return;
      }
      if (channelId === 'outlook' || channelId === 'zoho_mail') {
        const oauthChannel = channelId as ZeroOAuthChannelId;
        const integrationKey =
          oauthChannel === 'outlook' ? 'outlook_zero_oauth' : 'zoho_mail_zero_oauth';
        const config = await readChannelOAuthRuntimeConfig({
          repository: createSystemIntegrationRepository(db),
          integrationKey,
          encryptionKey: runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
          redirectUri: `${runtimeEnv.VITE_PUBLIC_BACKEND_URL.replace(/\/+$/u, '')}/api/integrations/${oauthChannel}/connect/callback`,
          providerConfig: await readChannelOAuthProviderConfig(db, oauthChannel),
        });
        await getMailOAuthGateway(oauthChannel).revokeToken(
          config,
          credential.refreshToken ?? credential.accessToken,
        );
      }
    },
    deleteBlobObjects: async (objectKeys) => {
      for (const objectKey of objectKeys) {
        await resources.blobStore.delete({
          accountId: parseObjectKey(objectKey).accountId,
          objectKey,
        });
      }
    },
    recordDiagnostic: (code, connectionId, error) => {
      console.warn(code, {
        connectionId,
        errorName: safeErrorName(error),
      });
    },
    now: () => new Date(),
  });
};
