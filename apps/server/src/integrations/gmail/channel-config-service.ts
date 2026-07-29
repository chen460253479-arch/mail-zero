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
import type { NangoChannelRuntimeStatus } from '../nango/channels';

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

type GmailIntegrationRepository = Pick<SystemIntegrationRepository, 'get'> & {
  countBindings(channelId: 'gmail', authSource?: GmailAuthSource): Promise<number>;
};

export type GmailChannelConfigServiceDependencies = {
  channels: ChannelConfigRepository;
  integrations: GmailIntegrationRepository;
  getNangoStatus(): Promise<NangoChannelRuntimeStatus>;
  publicBackendUrl: string;
  requestSubscriptionRefresh(provider: 'gmail'): Promise<void>;
  disableSubscriptions(provider: 'gmail'): Promise<void>;
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
      state: NangoChannelRuntimeStatus['state'];
      checkedAt: Date;
      errorCode: string | null;
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
    const [record, zeroOAuth, nangoBindings, zeroOAuthBindings, nangoStatus] = await Promise.all([
      dependencies.channels.get('gmail'),
      dependencies.integrations.get('gmail_zero_oauth'),
      dependencies.integrations.countBindings('gmail', 'nango'),
      dependencies.integrations.countBindings('gmail', 'zero_oauth'),
      dependencies.getNangoStatus(),
    ]);
    const config = parseRecord(record);
    const bindingCount = nangoBindings + zeroOAuthBindings;
    const zeroOAuthPublicConfig =
      zeroOAuth?.status === 'active'
        ? parsePublicConfig('gmail_zero_oauth', zeroOAuth.publicConfig)
        : null;
    const backendBaseUrl = dependencies.publicBackendUrl.replace(/\/+$/u, '');

    return {
      ...config,
      configured: record !== null,
      manualOnly: !config.inboxWatchEnabled && !config.scheduledSyncEnabled,
      authSourceLocked: record !== null || bindingCount > 0,
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

      const [currentRecord, zeroOAuth, nangoBindings, zeroOAuthBindings, nangoStatus] =
        await Promise.all([
          dependencies.channels.get('gmail'),
          candidate.authSource === 'zero_oauth'
            ? dependencies.integrations.get('gmail_zero_oauth')
            : Promise.resolve(null),
          dependencies.integrations.countBindings('gmail', 'nango'),
          dependencies.integrations.countBindings('gmail', 'zero_oauth'),
          dependencies.getNangoStatus(),
        ]);

      const boundSource =
        nangoBindings > 0 && zeroOAuthBindings === 0
          ? 'nango'
          : zeroOAuthBindings > 0 && nangoBindings === 0
            ? 'zero_oauth'
            : null;
      const currentSource = currentRecord?.authSource ?? boundSource;
      if (
        (currentRecord !== null && currentRecord.authSource !== candidate.authSource) ||
        (nangoBindings > 0 && zeroOAuthBindings > 0) ||
        (nangoBindings + zeroOAuthBindings > 0 &&
          (currentSource === null || currentSource !== candidate.authSource))
      ) {
        throw new GmailChannelConfigError('GMAIL_AUTH_SOURCE_IN_USE');
      }

      const selectedSourceReady =
        candidate.authSource === 'nango'
          ? nangoStatus.state === 'available'
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
      } else {
        await dependencies.disableSubscriptions('gmail');
      }
      return readSafeConfig();
    },
  };
};
