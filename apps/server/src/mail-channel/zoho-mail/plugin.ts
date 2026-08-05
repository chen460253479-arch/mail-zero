import {
  createZohoMailClient,
  resolveZohoMailBaseUrl,
  type ZohoMailClient,
  type ZohoMailboxContext,
} from './shared/zoho-client';
import type {
  MailChannelExternalData,
  MailChannelIdentity,
  MailChannelPlugin,
  ResolvedCredential,
} from '../contracts';
import { mergeZohoMailExternalData, parseZohoMailExternalData } from './external-data';
import { createZohoMailOutboundAdapter } from './outbound/adapter';
import { createZohoMailTransport } from './shared/zoho-transport';
import { createZohoMailIngressAdapter } from './inbound/adapter';
import { zohoMailNangoProviders } from './metadata';

export type ZohoMailPluginDependencies = {
  createClient(input: {
    connectionId?: string;
    credential: ResolvedCredential;
    externalData?: MailChannelExternalData;
  }): Promise<ZohoMailClient>;
};

const defaultDependencies: ZohoMailPluginDependencies = {
  createClient: async ({ credential, externalData }) =>
    createZohoMailClient(
      createZohoMailTransport(credential, resolveZohoMailBaseUrl('com')),
      externalData === undefined ? undefined : parseZohoMailExternalData(externalData),
    ),
};

const toIdentity = (context: ZohoMailboxContext): MailChannelIdentity => ({
  email: context.email,
  name: context.name,
  picture: context.picture,
});

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
  parseExternalData: (value) => parseZohoMailExternalData(value),
  mergeExternalData: ({ existing, incoming }) => mergeZohoMailExternalData(existing, incoming),
  resolveBinding: async (input) => {
    const externalData =
      input.externalData === undefined ? undefined : parseZohoMailExternalData(input.externalData);
    const context = await (
      await dependencies.createClient({ ...input, externalData })
    ).getMailboxContext();
    return {
      identity: toIdentity(context),
      externalData:
        externalData !== undefined && externalData.folderIds === undefined
          ? { accountId: context.accountId }
          : {
              accountId: context.accountId,
              folderIds: context.folderIds,
            },
    };
  },
  resolveIdentity: async (input): Promise<MailChannelIdentity> => {
    const context = await (await dependencies.createClient(input)).getMailboxContext();
    return toIdentity(context);
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
