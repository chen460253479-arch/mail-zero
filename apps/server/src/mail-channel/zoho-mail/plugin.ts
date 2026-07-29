import {
  createZohoMailClient,
  resolveZohoMailBaseUrl,
  type ZohoMailClient,
} from './shared/zoho-client';
import type { MailChannelIdentity, MailChannelPlugin, ResolvedCredential } from '../contracts';
import { createZohoMailOutboundAdapter } from './outbound/adapter';
import { createZohoMailTransport } from './shared/zoho-transport';
import { createZohoMailIngressAdapter } from './inbound/adapter';
import { zohoMailNangoProviders } from './metadata';

export type ZohoMailPluginDependencies = {
  createClient(input: {
    connectionId?: string;
    credential: ResolvedCredential;
  }): Promise<ZohoMailClient>;
};

const defaultDependencies: ZohoMailPluginDependencies = {
  createClient: async ({ credential }) =>
    createZohoMailClient(createZohoMailTransport(credential, resolveZohoMailBaseUrl('com'))),
};

export const createZohoMailPlugin = (
  dependencies: ZohoMailPluginDependencies = defaultDependencies,
): MailChannelPlugin => ({
  id: 'zoho_mail',
  providerKey: 'zoho_mail',
  displayName: 'Zoho Mail',
  credentialTypes: new Set(['oauth2']),
  capabilities: new Set(['read_messages', 'send_messages', 'push_sync']),
  nangoProviders: zohoMailNangoProviders,
  syncModes: new Set(['scheduled', 'webhook']),
  webhookKind: 'zoho_mail',
  resolveIdentity: async (input): Promise<MailChannelIdentity> => {
    const context = await (await dependencies.createClient(input)).getMailboxContext();
    return {
      email: context.email,
      name: context.name,
      picture: context.picture,
    };
  },
  inbound: {
    createAdapter: async (input) => {
      const client = await dependencies.createClient(input);
      return createZohoMailIngressAdapter(client, await client.getMailboxContext());
    },
  },
  outbound: {
    createAdapter: async (input) => {
      const client = await dependencies.createClient(input);
      return createZohoMailOutboundAdapter(client, await client.getMailboxContext());
    },
  },
});

export const zohoMailPlugin = createZohoMailPlugin();
