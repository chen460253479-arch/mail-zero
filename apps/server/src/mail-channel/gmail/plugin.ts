import { createGmailTransportFromExecutor, type GmailApiExecutor } from './shared/api-transport';
import type { MailChannelIdentity, MailChannelPlugin, ResolvedCredential } from '../contracts';
import { createGoogleGmailApiExecutor, resolveGoogleGmailIdentity } from './shared/google-api';
import { createGmailIngressAdapter } from './inbound/adapter';
import { createGmailApiClient } from './shared/api-client';
import { gmailNangoProviders } from './metadata';

export type GmailPluginDependencies = {
  createExecutor(input: {
    connectionId?: string;
    credential: ResolvedCredential;
  }): Promise<GmailApiExecutor>;
  resolveIdentity(input: {
    connectionId?: string;
    credential: ResolvedCredential;
  }): Promise<MailChannelIdentity>;
};

const defaultDependencies: GmailPluginDependencies = {
  createExecutor: async ({ credential }) => createGoogleGmailApiExecutor(credential),
  resolveIdentity: async ({ credential }) => await resolveGoogleGmailIdentity(credential),
};

export const createGmailPlugin = (
  dependencies: GmailPluginDependencies = defaultDependencies,
): MailChannelPlugin => ({
  id: 'gmail',
  providerKey: 'gmail',
  displayName: 'Gmail',
  credentialTypes: new Set(['oauth2']),
  capabilities: new Set(['read_messages', 'push_sync']),
  nangoProviders: gmailNangoProviders,
  resolveIdentity: async (input) => await dependencies.resolveIdentity(input),
  inbound: {
    createAdapter: async (input) => {
      const executor = await dependencies.createExecutor(input);
      return createGmailIngressAdapter(
        createGmailApiClient(createGmailTransportFromExecutor(executor)),
      );
    },
  },
});

export const gmailPlugin = createGmailPlugin();
