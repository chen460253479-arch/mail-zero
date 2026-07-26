import type { InboundMailAdapter } from '../../modules/mail-sync/domain/ingress-adapter';

import type { MailCredentialType, ResolvedCredential } from './credentials';

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

export type MailChannelIdentity = {
  email: string;
  name: string;
  picture: string;
};

export type MailChannelDescriptor = {
  readonly id: MailChannelId;
  readonly providerKey: string;
  readonly displayName: string;
  readonly credentialTypes: ReadonlySet<MailCredentialType>;
  readonly capabilities: ReadonlySet<MailCapability>;
  readonly nangoProviders?: readonly string[];
};

export type MailChannelInboundCapability = {
  createAdapter(input: {
    connectionId: string;
    credential: ResolvedCredential;
  }): Promise<InboundMailAdapter>;
};

export interface MailChannelPlugin extends MailChannelDescriptor {
  resolveIdentity(input: {
    connectionId?: string;
    credential: ResolvedCredential;
  }): Promise<MailChannelIdentity>;
  readonly inbound?: MailChannelInboundCapability;
}
