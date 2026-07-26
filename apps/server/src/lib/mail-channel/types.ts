import type { InboundMailAdapterFactory } from '../../modules/mail-sync';
import type { MailClient, ManagerConfig } from '../driver/types';
import type { ChannelSyncAdapter } from './sync-types';

export const mailChannelIds = ['gmail', 'outlook', 'zoho_mail', 'imap_smtp'] as const;
export type MailChannelId = (typeof mailChannelIds)[number];

export const mailCapabilities = [
  'read_messages',
  'send_messages',
  'drafts',
  'attachments',
  'labels',
  'threads',
  'push_sync',
] as const;
export type MailCapability = (typeof mailCapabilities)[number];

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

export interface MailboxChannel {
  id: MailChannelId;
  providerKey: string;
  displayName: string;
  legacyProviderId?: 'google' | 'microsoft';
  nangoProviders?: readonly string[];
  credentialTypes: ReadonlySet<MailCredentialType>;
  capabilities: ReadonlySet<MailCapability>;
  inbound?: InboundMailAdapterFactory;
  sync?: ChannelSyncAdapter;
  createClient(config: ManagerConfig): MailClient;
  resolveIdentity(config: ManagerConfig): Promise<{ email: string; name: string; picture: string }>;
  getScope(config: ManagerConfig): string;
  revoke(config: ManagerConfig, token: string): Promise<boolean>;
}
