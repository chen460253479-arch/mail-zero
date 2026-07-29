import type {
  ChannelConfigRepository,
  SaveChannelConfigInput,
} from '../core/channel-config-repository';
import { defaultMailChannelConfig, parseMailChannelConfig } from '../../mail-channel/config';
import type { MailChannelConfig, MailChannelConfigInput } from '../../mail-channel/config';
import { parsePublicConfig, type SystemIntegrationRepository } from '../core/repository';
import type { NangoChannelRuntimeStatus } from '../nango/channels';
import type { MailChannelId } from '../../mail-channel/contracts';
import type { IntegrationKey } from '../core/schemas';

export type ManagedChannelId = Exclude<MailChannelId, 'gmail'>;

export type MailChannelConfigErrorCode =
  | 'MAIL_CHANNEL_AUTH_SOURCE_NOT_CONFIGURED'
  | 'MAIL_CHANNEL_AUTH_SOURCE_IN_USE'
  | 'MAIL_CHANNEL_CONFIG_INVALID';

export class MailChannelConfigError extends Error {
  constructor(readonly code: MailChannelConfigErrorCode) {
    super(code);
    this.name = 'MailChannelConfigError';
  }
}

type IntegrationRepository = Pick<SystemIntegrationRepository, 'get'> & {
  countBindings(
    channelId: MailChannelId,
    authSource?: 'zero_oauth' | 'nango' | 'manual',
  ): Promise<number>;
};

export type MailChannelConfigServiceDependencies = {
  channels: ChannelConfigRepository;
  integrations: IntegrationRepository;
  getNangoStatus(channelId: MailChannelId): Promise<NangoChannelRuntimeStatus>;
  publicBackendUrl: string;
  protocolWorkerAvailable: boolean;
  requestSubscriptionRefresh(provider: MailChannelId): Promise<void>;
  disableSubscriptions(provider: MailChannelId): Promise<void>;
};

type SourceSummary = {
  configured: boolean;
  bindingCount: number;
};

export type SafeManagedChannelConfig = MailChannelConfig & {
  channelId: ManagedChannelId;
  configured: boolean;
  manualOnly: boolean;
  authSourceLocked: boolean;
  bindingCount: number;
  webhookUrl: string | null;
  authorizationSources: {
    zero_oauth:
      | (SourceSummary & {
          clientId: string | null;
          redirectUris: { validation: string; mailbox: string };
        })
      | null;
    nango: SourceSummary & {
      state: NangoChannelRuntimeStatus['state'];
      checkedAt: Date;
      errorCode: string | null;
    };
    manual: (SourceSummary & { available: boolean }) | null;
  };
};

const integrationKeyByChannel = {
  outlook: 'outlook_zero_oauth',
  zoho_mail: 'zoho_mail_zero_oauth',
} as const satisfies Partial<Record<ManagedChannelId, IntegrationKey>>;

const assertManagedChannel = (channelId: MailChannelId): ManagedChannelId => {
  if (channelId === 'gmail') {
    throw new MailChannelConfigError('MAIL_CHANNEL_CONFIG_INVALID');
  }
  return channelId;
};

const parseRecord = (
  channelId: ManagedChannelId,
  record: Awaited<ReturnType<ChannelConfigRepository['get']>>,
): MailChannelConfig => {
  if (record === null) return defaultMailChannelConfig(channelId);
  try {
    return parseMailChannelConfig(channelId, {
      channelId,
      authSource: record.authSource,
      inboxWatchEnabled: record.inboxWatchEnabled,
      scheduledSyncEnabled: record.scheduledSyncEnabled,
      syncIntervalMinutes: record.syncIntervalMinutes,
      providerConfig: record.providerConfig,
    });
  } catch {
    throw new MailChannelConfigError('MAIL_CHANNEL_CONFIG_INVALID');
  }
};

const webhookUrl = (backendUrl: string, channelId: ManagedChannelId): string | null => {
  const base = backendUrl.replace(/\/+$/u, '');
  if (channelId === 'outlook') return `${base}/api/webhooks/mail/outlook`;
  if (channelId === 'zoho_mail') return `${base}/api/webhooks/mail/zoho/:endpointToken`;
  return null;
};

const redirectUris = (backendUrl: string, channelId: 'outlook' | 'zoho_mail') => {
  const base = backendUrl.replace(/\/+$/u, '');
  return {
    validation: `${base}/api/integrations/${channelId}/validation/callback`,
    mailbox: `${base}/api/integrations/${channelId}/connect/callback`,
  };
};

export const createMailChannelConfigService = (
  dependencies: MailChannelConfigServiceDependencies,
) => {
  const readSafeConfig = async (
    candidateChannelId: MailChannelId,
  ): Promise<SafeManagedChannelConfig> => {
    const channelId = assertManagedChannel(candidateChannelId);
    const integrationKey = channelId === 'imap_smtp' ? null : integrationKeyByChannel[channelId];
    const [record, integration, zeroBindings, nangoBindings, manualBindings, nangoStatus] =
      await Promise.all([
        dependencies.channels.get(channelId),
        integrationKey === null
          ? Promise.resolve(null)
          : dependencies.integrations.get(integrationKey),
        dependencies.integrations.countBindings(channelId, 'zero_oauth'),
        dependencies.integrations.countBindings(channelId, 'nango'),
        dependencies.integrations.countBindings(channelId, 'manual'),
        dependencies.getNangoStatus(channelId),
      ]);
    const config = parseRecord(channelId, record);
    const bindingCount = zeroBindings + nangoBindings + manualBindings;
    const zeroPublic =
      integrationKey !== null && integration?.status === 'active'
        ? parsePublicConfig(integrationKey, integration.publicConfig)
        : null;

    return {
      ...config,
      channelId,
      configured: record !== null,
      manualOnly: !config.inboxWatchEnabled && !config.scheduledSyncEnabled,
      authSourceLocked: bindingCount > 0,
      bindingCount,
      webhookUrl: webhookUrl(dependencies.publicBackendUrl, channelId),
      authorizationSources: {
        zero_oauth:
          integrationKey === null
            ? null
            : {
                configured: zeroPublic !== null,
                clientId: zeroPublic?.clientId ?? null,
                bindingCount: zeroBindings,
                redirectUris: redirectUris(
                  dependencies.publicBackendUrl,
                  channelId as 'outlook' | 'zoho_mail',
                ),
              },
        nango: {
          ...nangoStatus,
          configured: nangoStatus.state === 'available',
          bindingCount: nangoBindings,
        },
        manual:
          channelId === 'imap_smtp'
            ? {
                configured: dependencies.protocolWorkerAvailable,
                available: dependencies.protocolWorkerAvailable,
                bindingCount: manualBindings,
              }
            : null,
      },
    } as SafeManagedChannelConfig;
  };

  return {
    get: readSafeConfig,

    save: async (
      input: MailChannelConfigInput & { updatedBy: string },
    ): Promise<SafeManagedChannelConfig> => {
      const channelId = assertManagedChannel(input.channelId);
      let candidate: MailChannelConfig;
      try {
        candidate = parseMailChannelConfig(channelId, input);
      } catch {
        throw new MailChannelConfigError('MAIL_CHANNEL_CONFIG_INVALID');
      }

      const integrationKey = channelId === 'imap_smtp' ? null : integrationKeyByChannel[channelId];
      const [current, integration, zeroBindings, nangoBindings, manualBindings, nangoStatus] =
        await Promise.all([
          dependencies.channels.get(channelId),
          integrationKey === null
            ? Promise.resolve(null)
            : dependencies.integrations.get(integrationKey),
          dependencies.integrations.countBindings(channelId, 'zero_oauth'),
          dependencies.integrations.countBindings(channelId, 'nango'),
          dependencies.integrations.countBindings(channelId, 'manual'),
          dependencies.getNangoStatus(channelId),
        ]);
      const counts = {
        zero_oauth: zeroBindings,
        nango: nangoBindings,
        manual: manualBindings,
      } as const;
      const boundSources = Object.entries(counts).filter(([, count]) => count > 0);
      if (
        boundSources.length > 1 ||
        (boundSources.length === 1 && boundSources[0]?.[0] !== candidate.authSource) ||
        (current !== null && boundSources.length > 0 && current.authSource !== candidate.authSource)
      ) {
        throw new MailChannelConfigError('MAIL_CHANNEL_AUTH_SOURCE_IN_USE');
      }

      const sourceReady =
        candidate.authSource === 'zero_oauth'
          ? integration?.status === 'active'
          : candidate.authSource === 'nango'
            ? nangoStatus.state === 'available'
            : dependencies.protocolWorkerAvailable;
      if (!sourceReady) {
        throw new MailChannelConfigError('MAIL_CHANNEL_AUTH_SOURCE_NOT_CONFIGURED');
      }

      await dependencies.channels.save({
        ...candidate,
        updatedBy: input.updatedBy,
      } satisfies SaveChannelConfigInput);
      if (candidate.inboxWatchEnabled) {
        await dependencies.requestSubscriptionRefresh(channelId);
      } else {
        await dependencies.disableSubscriptions(channelId);
      }
      return await readSafeConfig(channelId);
    },
  };
};
