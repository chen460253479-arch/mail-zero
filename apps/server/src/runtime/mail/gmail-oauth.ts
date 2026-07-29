import {
  GmailOAuthService,
  gmailOAuthRedirectUris,
  type GmailOAuthMailboxRepository,
} from '../../modules/mail-accounts/application/connect-gmail-oauth';
import { GoogleGmailOAuthGateway } from '../../mail-channel/gmail/auth/google-oauth-gateway';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';

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
