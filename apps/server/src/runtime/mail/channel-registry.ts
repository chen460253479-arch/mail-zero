import {
  createZohoMailClient,
  resolveZohoMailBaseUrl,
} from '../../mail-channel/zoho-mail/shared/zoho-client';
import { createChannelConfigRepository } from '../../integrations/core/channel-config-repository';
import { createZohoMailTransport } from '../../mail-channel/zoho-mail/shared/zoho-transport';
import { defaultZohoMailChannelConfig } from '../../mail-channel/zoho-mail/config';
import { parseZohoMailChannelConfig } from '../../mail-channel/zoho-mail/config';
import { createMailChannelRegistry } from '../../mail-channel/registry';
import { createImapSmtpPluginForEnvironment } from './protocol-channel';
import { createZohoMailPlugin } from '../../mail-channel/zoho-mail';
import { outlookPlugin } from '../../mail-channel/outlook';
import { gmailPlugin } from '../../mail-channel/gmail';
import type { ZeroEnv } from '../../env';
import type { DB } from '../../db';

const readZohoDataCenter = async (db: DB): Promise<string> => {
  const record = await createChannelConfigRepository(db).get('zoho_mail');
  if (record === null) return defaultZohoMailChannelConfig.providerConfig.dataCenter;
  return parseZohoMailChannelConfig({
    channelId: 'zoho_mail',
    authSource: record.authSource,
    inboxWatchEnabled: record.inboxWatchEnabled,
    scheduledSyncEnabled: record.scheduledSyncEnabled,
    syncIntervalMinutes: record.syncIntervalMinutes,
    providerConfig: record.providerConfig,
  }).providerConfig.dataCenter;
};

export const createZohoMailPluginForDatabase = (db: DB) =>
  createZohoMailPlugin({
    createClient: async ({ credential }) =>
      createZohoMailClient(
        createZohoMailTransport(credential, resolveZohoMailBaseUrl(await readZohoDataCenter(db))),
      ),
  });

export const createIdentityMailChannelRegistry = (db: DB, runtimeEnv: ZeroEnv) =>
  createMailChannelRegistry([
    gmailPlugin,
    outlookPlugin,
    createZohoMailPluginForDatabase(db),
    createImapSmtpPluginForEnvironment(runtimeEnv),
  ]);
