export type OAuth2Credential = {
  type: 'oauth2';
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date | null;
  scope: string;
};

export type BasicCredential = {
  type: 'basic';
  username: string;
  password: string;
  host: string;
  port: number;
  secure: boolean;
};

export type ResolvedCredential = OAuth2Credential | BasicCredential;
export type MailCredentialType = ResolvedCredential['type'] | 'custom';
