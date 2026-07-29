import type { MailChannelIdentity } from '../contracts';

export type MailOAuthRuntimeConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  providerConfig: Record<string, unknown>;
};

export type MailOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
};

export interface MailOAuthGateway {
  createAuthorizationUrl(input: MailOAuthRuntimeConfig & { state: string }): string;
  exchangeCode(config: MailOAuthRuntimeConfig, code: string): Promise<MailOAuthTokens>;
  refreshTokens(config: MailOAuthRuntimeConfig, refreshToken: string): Promise<MailOAuthTokens>;
  resolveIdentity(
    config: MailOAuthRuntimeConfig,
    tokens: MailOAuthTokens,
  ): Promise<MailChannelIdentity>;
  revokeToken(config: MailOAuthRuntimeConfig, token: string): Promise<void>;
}
