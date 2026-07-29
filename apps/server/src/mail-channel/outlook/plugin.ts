import type { MailChannelIdentity, MailChannelPlugin, ResolvedCredential } from '../contracts';
import { createMicrosoftGraphClient, type MicrosoftGraphClient } from './shared/graph-client';
import { createMicrosoftGraphTransport } from './shared/graph-transport';
import { createOutlookOutboundAdapter } from './outbound/adapter';
import { createOutlookIngressAdapter } from './inbound/adapter';
import { outlookNangoProviders } from './metadata';

export type OutlookPluginDependencies = {
  createClient(input: {
    connectionId?: string;
    credential: ResolvedCredential;
  }): Promise<MicrosoftGraphClient>;
};

const defaultDependencies: OutlookPluginDependencies = {
  createClient: async ({ credential }) =>
    createMicrosoftGraphClient(createMicrosoftGraphTransport(credential)),
};

export const createOutlookPlugin = (
  dependencies: OutlookPluginDependencies = defaultDependencies,
): MailChannelPlugin => ({
  id: 'outlook',
  providerKey: 'outlook',
  displayName: 'Outlook',
  credentialTypes: new Set(['oauth2']),
  capabilities: new Set(['read_messages', 'send_messages', 'push_sync']),
  nangoProviders: outlookNangoProviders,
  syncModes: new Set(['scheduled', 'webhook']),
  webhookKind: 'microsoft_graph',
  resolveIdentity: async (input): Promise<MailChannelIdentity> =>
    await (await dependencies.createClient(input)).getIdentity(),
  inbound: {
    createAdapter: async (input) =>
      createOutlookIngressAdapter(await dependencies.createClient(input)),
  },
  outbound: {
    createAdapter: async (input) =>
      createOutlookOutboundAdapter(await dependencies.createClient(input)),
  },
});

export const outlookPlugin = createOutlookPlugin();
