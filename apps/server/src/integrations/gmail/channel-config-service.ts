import {
  parseGmailChannelConfig,
  defaultGmailChannelConfig,
  type GmailAuthSource,
  type GmailChannelConfig,
  type GmailChannelProviderConfig,
} from '../../mail-channel/gmail/config';
import type {
  ChannelConfigRepository,
  SaveChannelConfigInput,
} from '../core/channel-config-repository';
import { parsePublicConfig, type SystemIntegrationRepository } from '../core/repository';
import type { NangoRuntimeStatus } from '../nango/service';

export type GmailChannelConfigErrorCode =
  | 'GMAIL_AUTH_SOURCE_NOT_CONFIGURED'
  | 'GMAIL_AUTH_SOURCE_IN_USE'
  | 'GMAIL_CHANNEL_CONFIG_INVALID';

export class GmailChannelConfigError extends Error {
  constructor(readonly code: GmailChannelConfigErrorCode) {
    super(code);
    this.name = 'GmailChannelConfigError';
  }
}

type GmailIntegrationRepository = Pick<SystemIntegrationRepository, 'get' | 'getMapping'> & {
  countBindings(channelId: 'gmail', authSource?: GmailAuthSource): Promise<number>;
};

export type GmailChannelConfigServiceDependencies = {
  channels: ChannelConfigRepository;
  integrations: GmailIntegrationRepository;
  getNangoStatus(): NangoRuntimeStatus;
  publicBackendUrl: string;
  requestSubscriptionRefresh(provider: 'gmail'): Promise<void>;
};

export type SaveGmailChannelConfigInput = {
  authSource: GmailAuthSource;
  inboxWatchEnabled: boolean;
  scheduledSyncEnabled: boolean;
  syncIntervalMinutes: number;
  providerConfig: GmailChannelProviderConfig;
  updatedBy: string;
};

export type SafeGmailChannelConfig = GmailChannelConfig & {
  configured: boolean;
  manualOnly: boolean;
  authSourceLocked: boolean;
  bindingCount: number;
  webhookUrl: string;
  authorizationSources: {
    zero_oauth: {
      configured: boolean;
      clientId: string | null;
      bindingCount: number;
      redirectUris: {
        validation: string;
        mailbox: string;
      };
    };
    nango: {
      state: NangoRuntimeStatus['state'];
      checkedAt: Date | null;
      errorCode: string | null;
      gmailIntegrationId: string | null;
      bindingCount: number;
    };
  };
};

export interface GmailChannelConfigService {
  get(): Promise<SafeGmailChannelConfig>;
  save(input: SaveGmailChannelConfigInput): Promise<SafeGmailChannelConfig>;
}

const parseRecord = (
  record: Awaited<ReturnType<ChannelConfigRepository['get']>>,
): GmailChannelConfig => {
  if (record === null) return defaultGmailChannelConfig;
  try {
    return parseGmailChannelConfig({
      channelId: record.channelId,
      authSource: record.authSource,
      inboxWatchEnabled: record.inboxWatchEnabled,
      scheduledSyncEnabled: record.scheduledSyncEnabled,
      syncIntervalMinutes: record.syncIntervalMinutes,
      providerConfig: record.providerConfig,
    });
  } catch {
    throw new GmailChannelConfigError('GMAIL_CHANNEL_CONFIG_INVALID');
  }
};

export const createGmailChannelConfigService = (
  dependencies: GmailChannelConfigServiceDependencies,
): GmailChannelConfigService => {
  const readSafeConfig = async (): Promise<SafeGmailChannelConfig> => {
    const [record, zeroOAuth, gmailMapping, nangoBindings, zeroOAuthBindings] = await Promise.all([
      dependencies.channels.get('gmail'),
      dependencies.integrations.get('gmail_zero_oauth'),
      dependencies.integrations.getMapping('gmail', 'nango'),
      dependencies.integrations.countBindings('gmail', 'nango'),
      dependencies.integrations.countBindings('gmail', 'zero_oauth'),
    ]);
    const config = parseRecord(record);
    const bindingCount = nangoBindings + zeroOAuthBindings;
    const nangoStatus = dependencies.getNangoStatus();
    const zeroOAuthPublicConfig =
      zeroOAuth?.status === 'active'
        ? parsePublicConfig('gmail_zero_oauth', zeroOAuth.publicConfig)
        : null;
    const backendBaseUrl = dependencies.publicBackendUrl.replace(/\/+$/u, '');

    return {
      ...config,
      configured: record !== null,
      manualOnly: !config.inboxWatchEnabled && !config.scheduledSyncEnabled,
      authSourceLocked: bindingCount > 0,
      bindingCount,
      webhookUrl: `${backendBaseUrl}/api/mail/channels/gmail/push`,
      authorizationSources: {
        zero_oauth: {
          configured: zeroOAuthPublicConfig !== null,
          clientId: zeroOAuthPublicConfig?.clientId ?? null,
          bindingCount: zeroOAuthBindings,
          redirectUris: {
            validation: `${backendBaseUrl}/api/integrations/gmail/validation/callback`,
            mailbox: `${backendBaseUrl}/api/integrations/gmail/connect/callback`,
          },
        },
        nango: {
          ...nangoStatus,
          gmailIntegrationId: gmailMapping?.externalIntegrationId ?? null,
          bindingCount: nangoBindings,
        },
      },
    };
  };

  return {
    get: readSafeConfig,

    save: async (input) => {
      let candidate: GmailChannelConfig;
      try {
        candidate = parseGmailChannelConfig({
          channelId: 'gmail',
          authSource: input.authSource,
          inboxWatchEnabled: input.inboxWatchEnabled,
          scheduledSyncEnabled: input.scheduledSyncEnabled,
          syncIntervalMinutes: input.syncIntervalMinutes,
          providerConfig: input.providerConfig,
        });
      } catch {
        throw new GmailChannelConfigError('GMAIL_CHANNEL_CONFIG_INVALID');
      }

      const [currentRecord, zeroOAuth, gmailMapping, nangoBindings, zeroOAuthBindings] =
        await Promise.all([
          dependencies.channels.get('gmail'),
          candidate.authSource === 'zero_oauth'
            ? dependencies.integrations.get('gmail_zero_oauth')
            : Promise.resolve(null),
          candidate.authSource === 'nango'
            ? dependencies.integrations.getMapping('gmail', 'nango')
            : Promise.resolve(null),
          dependencies.integrations.countBindings('gmail', 'nango'),
          dependencies.integrations.countBindings('gmail', 'zero_oauth'),
        ]);

      const boundSource =
        nangoBindings > 0 && zeroOAuthBindings === 0
          ? 'nango'
          : zeroOAuthBindings > 0 && nangoBindings === 0
            ? 'zero_oauth'
            : null;
      const currentSource = currentRecord?.authSource ?? boundSource;
      if (
        (nangoBindings > 0 && zeroOAuthBindings > 0) ||
        (nangoBindings + zeroOAuthBindings > 0 &&
          (currentSource === null || currentSource !== candidate.authSource))
      ) {
        throw new GmailChannelConfigError('GMAIL_AUTH_SOURCE_IN_USE');
      }

      const selectedSourceReady =
        candidate.authSource === 'nango'
          ? dependencies.getNangoStatus().state === 'available' && gmailMapping !== null
          : zeroOAuth?.status === 'active';
      if (!selectedSourceReady) {
        throw new GmailChannelConfigError('GMAIL_AUTH_SOURCE_NOT_CONFIGURED');
      }

      const persistenceInput: SaveChannelConfigInput = {
        ...candidate,
        updatedBy: input.updatedBy,
      };
      await dependencies.channels.save(persistenceInput);
      if (candidate.inboxWatchEnabled) {
        await dependencies.requestSubscriptionRefresh('gmail');
      }
      return readSafeConfig();
    },
  };
};
