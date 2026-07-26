export type GmailOAuthRuntimeConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GmailOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
};

export interface GmailOAuthGateway {
  createAuthorizationUrl(input: GmailOAuthRuntimeConfig & { state: string }): string;
  exchangeCode(config: GmailOAuthRuntimeConfig, code: string): Promise<GmailOAuthTokens>;
  resolveIdentity(
    config: GmailOAuthRuntimeConfig,
    tokens: GmailOAuthTokens,
  ): Promise<{ email: string; name: string; picture: string }>;
  revokeToken(config: GmailOAuthRuntimeConfig, token: string): Promise<void>;
}
