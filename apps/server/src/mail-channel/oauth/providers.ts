import { MicrosoftOutlookOAuthGateway } from '../outlook/auth/microsoft-oauth-gateway';
import { ZohoMailOAuthGateway } from '../zoho-mail/auth/zoho-oauth-gateway';
import type { MailChannelId } from '../contracts';

type ZeroOAuthChannelId = Extract<MailChannelId, 'outlook' | 'zoho_mail'>;

const gateways = {
  outlook: new MicrosoftOutlookOAuthGateway(),
  zoho_mail: new ZohoMailOAuthGateway(),
} as const;

export const getMailOAuthGateway = (channelId: ZeroOAuthChannelId) => gateways[channelId];
