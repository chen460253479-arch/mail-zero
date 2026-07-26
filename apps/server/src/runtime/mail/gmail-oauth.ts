import {
  GmailOAuthService,
  readGmailOAuthRuntimeConfig,
  gmailOAuthRedirectUris,
  type GmailOAuthMailboxRepository,
  type GmailOAuthRuntimeConfig,
} from '../../modules/mail-accounts/application/connect-gmail-oauth';
import { GoogleGmailOAuthGateway } from '../../mail-channel/gmail/auth/google-oauth-gateway';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';
import { createDb } from '../../db';

export const loadGmailOAuthRuntimeConfig = async (input: {
  databaseUrl: string;
  encryptionKey: string;
  redirectUri: string;
}): Promise<GmailOAuthRuntimeConfig> => {
  const { db, conn } = createDb(input.databaseUrl);
  try {
    return await readGmailOAuthRuntimeConfig({
      repository: createSystemIntegrationRepository(db),
      encryptionKey: input.encryptionKey,
      redirectUri: input.redirectUri,
    });
  } finally {
    await conn.end();
  }
};

export const createGmailOAuthApplication = (input: {
  repository: ReturnType<typeof createSystemIntegrationRepository>;
  saveMailbox: GmailOAuthMailboxRepository['save'];
  encryptionKey: string;
  backendUrl: string;
}): GmailOAuthService =>
  new GmailOAuthService({
    repository: input.repository,
    mailboxRepository: { save: input.saveMailbox },
    gateway: new GoogleGmailOAuthGateway(),
    encryptionKey: input.encryptionKey,
    redirectUris: gmailOAuthRedirectUris(input.backendUrl),
    now: () => new Date(),
  });
