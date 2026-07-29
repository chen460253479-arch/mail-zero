import type {
  ImapSmtpCredential,
  MailChannelIdentity,
  MailChannelPlugin,
  ResolvedCredential,
} from '../contracts';
import type { MailProtocolClient } from './shared/protocol-client';
import { createImapSmtpOutboundAdapter } from './outbound/adapter';
import { createImapSmtpIngressAdapter } from './inbound/adapter';
import { imapSmtpNangoProviders } from './metadata';

export type ImapSmtpPluginDependencies = {
  createClient(credential: ImapSmtpCredential): Promise<MailProtocolClient>;
  clock?: { now(): Date };
};

const requireCredential = (credential: ResolvedCredential): ImapSmtpCredential => {
  if (credential.type !== 'imap_smtp') {
    throw new Error('IMAP_SMTP_CREDENTIAL_REQUIRED');
  }
  return credential;
};

const unavailableDependencies: ImapSmtpPluginDependencies = {
  createClient: async () => {
    throw new Error('MAIL_PROTOCOL_EXECUTOR_NOT_CONFIGURED');
  },
};

export const createImapSmtpPlugin = (
  dependencies: ImapSmtpPluginDependencies = unavailableDependencies,
): MailChannelPlugin => ({
  id: 'imap_smtp',
  providerKey: 'imap_smtp',
  displayName: 'IMAP/SMTP',
  credentialTypes: new Set(['imap_smtp']),
  capabilities: new Set(['read_messages', 'send_messages']),
  nangoProviders: imapSmtpNangoProviders,
  syncModes: new Set(['scheduled']),
  resolveIdentity: async ({ credential }): Promise<MailChannelIdentity> => {
    const client = await dependencies.createClient(requireCredential(credential));
    const identity = await client.verify();
    return { email: identity.email, name: '', picture: '' };
  },
  inbound: {
    createAdapter: async ({ credential }) =>
      createImapSmtpIngressAdapter(
        await dependencies.createClient(requireCredential(credential)),
        dependencies.clock,
      ),
  },
  outbound: {
    createAdapter: async ({ credential }) =>
      createImapSmtpOutboundAdapter(
        await dependencies.createClient(requireCredential(credential)),
        dependencies.clock,
      ),
  },
});

export const imapSmtpPlugin = createImapSmtpPlugin();
