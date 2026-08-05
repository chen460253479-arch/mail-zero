import type { InboundMailAdapter } from '../../modules/mail-sync/domain/ingress-adapter';

import type { MailCredentialType, ResolvedCredential } from './credentials';
import type { OutboundMailAdapter } from './outbound';

export const mailChannelIds = ['gmail', 'outlook', 'zoho_mail', 'imap_smtp'] as const;
export type MailChannelId = (typeof mailChannelIds)[number];

export const mailSyncModes = ['scheduled', 'webhook'] as const;
export type MailSyncMode = (typeof mailSyncModes)[number];

export const mailWebhookKinds = ['gmail_pubsub', 'microsoft_graph', 'zoho_mail'] as const;
export type MailWebhookKind = (typeof mailWebhookKinds)[number];

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

export type MailChannelExternalData = Record<string, unknown>;

export type MailChannelBinding = {
  identity: MailChannelIdentity;
  externalData: MailChannelExternalData | null;
};

export type MailChannelDescriptor = {
  readonly id: MailChannelId;
  readonly providerKey: string;
  readonly displayName: string;
  readonly credentialTypes: ReadonlySet<MailCredentialType>;
  readonly capabilities: ReadonlySet<MailCapability>;
  readonly nangoProviders?: readonly string[];
  readonly syncModes?: ReadonlySet<MailSyncMode>;
  readonly webhookKind?: MailWebhookKind;
};

export type MailChannelInboundCapability = {
  createAdapter(input: {
    connectionId: string;
    credential: ResolvedCredential;
  }): Promise<InboundMailAdapter>;
};

export type MailChannelOutboundCapability = {
  createAdapter(input: {
    connectionId: string;
    credential: ResolvedCredential;
  }): Promise<OutboundMailAdapter>;
};

export interface MailChannelPlugin extends MailChannelDescriptor {
  parseExternalData?(value: unknown): MailChannelExternalData;
  mergeExternalData?(input: {
    existing: MailChannelExternalData | null;
    incoming: MailChannelExternalData | null;
  }): MailChannelExternalData | null;
  resolveBinding?(input: {
    connectionId?: string;
    credential: ResolvedCredential;
    externalData?: MailChannelExternalData;
  }): Promise<MailChannelBinding>;
  resolveIdentity(input: {
    connectionId?: string;
    credential: ResolvedCredential;
  }): Promise<MailChannelIdentity>;
  readonly inbound?: MailChannelInboundCapability;
  readonly outbound?: MailChannelOutboundCapability;
}
