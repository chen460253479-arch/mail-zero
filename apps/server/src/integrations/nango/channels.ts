import type { NangoIntegrationService, NangoRuntimeErrorCode, NangoRuntimeStatus } from './service';
import type { MailChannelId } from '../../mail-channel/contracts';
import { mailChannelIds } from '../../mail-channel/contracts';
import type { NangoIntegration } from './schemas';
import { NangoIntegrationError } from './errors';
import type { ZeroEnv } from '../../env';

export type NangoChannelEnvironment = Pick<
  ZeroEnv,
  | 'NANGO_GMAIL_INTEGRATION_KEY'
  | 'NANGO_OUTLOOK_INTEGRATION_KEY'
  | 'NANGO_ZOHO_MAIL_INTEGRATION_KEY'
  | 'NANGO_IMAP_SMTP_INTEGRATION_KEY'
>;

type NangoChannelErrorCode =
  | NangoRuntimeErrorCode
  | 'NANGO_CHANNEL_KEY_MISSING'
  | 'NANGO_INTEGRATION_NOT_FOUND'
  | 'NANGO_PROVIDER_MISMATCH'
  | 'NANGO_INTEGRATION_UNAVAILABLE';

export type NangoChannelRuntimeStatus =
  | {
      state: 'unconfigured';
      checkedAt: Date;
      errorCode: 'NANGO_CHANNEL_KEY_MISSING';
    }
  | {
      state: 'available';
      checkedAt: Date;
      errorCode: null;
    }
  | {
      state: 'unavailable';
      checkedAt: Date;
      errorCode: Exclude<NangoChannelErrorCode, 'NANGO_CHANNEL_KEY_MISSING'>;
    };

type NangoChannelDescriptor = {
  id: MailChannelId;
  nangoProviders?: readonly string[];
};

type NangoRuntime = Pick<NangoIntegrationService, 'initialize' | 'listIntegrations'>;

type NangoChannelIntegrationDependencies = {
  environment: NangoChannelEnvironment;
  nango: NangoRuntime;
  getChannel(channelId: MailChannelId): NangoChannelDescriptor;
  now(): Date;
};

const environmentKeyByChannel = {
  gmail: 'NANGO_GMAIL_INTEGRATION_KEY',
  outlook: 'NANGO_OUTLOOK_INTEGRATION_KEY',
  zoho_mail: 'NANGO_ZOHO_MAIL_INTEGRATION_KEY',
  imap_smtp: 'NANGO_IMAP_SMTP_INTEGRATION_KEY',
} as const satisfies Record<MailChannelId, keyof NangoChannelEnvironment>;

const configuredKey = (
  environment: NangoChannelEnvironment,
  channelId: MailChannelId,
): string | null => {
  const value = environment[environmentKeyByChannel[channelId]]?.trim();
  return value ? value : null;
};

const runtimeFailureCode = (
  status: NangoRuntimeStatus,
): Exclude<NangoChannelErrorCode, 'NANGO_CHANNEL_KEY_MISSING'> =>
  status.state === 'unavailable' ? status.errorCode : 'NANGO_INTEGRATION_UNAVAILABLE';

export interface NangoChannelIntegrationService {
  initialize(): Promise<void>;
  getStatus(channelId: MailChannelId): Promise<NangoChannelRuntimeStatus>;
  requireIntegrationKey(channelId: MailChannelId): Promise<string>;
}

class DefaultNangoChannelIntegrationService implements NangoChannelIntegrationService {
  private initialization: Promise<void> | undefined;
  private readonly statuses = new Map<MailChannelId, NangoChannelRuntimeStatus>();

  constructor(private readonly dependencies: NangoChannelIntegrationDependencies) {}

  initialize(): Promise<void> {
    this.initialization ??= this.runInitialization();
    return this.initialization;
  }

  async getStatus(channelId: MailChannelId): Promise<NangoChannelRuntimeStatus> {
    await this.initialize();
    const status = this.statuses.get(channelId);
    if (!status) throw new Error(`Nango channel status is missing for ${channelId}`);
    return status;
  }

  async requireIntegrationKey(channelId: MailChannelId): Promise<string> {
    const status = await this.getStatus(channelId);
    if (status.state === 'available') {
      const integrationKey = configuredKey(this.dependencies.environment, channelId);
      if (integrationKey) return integrationKey;
    }
    const code =
      status.errorCode === 'NANGO_CHANNEL_KEY_MISSING' ||
      status.errorCode === 'NANGO_INTEGRATION_NOT_FOUND' ||
      status.errorCode === 'NANGO_PROVIDER_MISMATCH'
        ? status.errorCode
        : 'NANGO_INTEGRATION_UNAVAILABLE';
    throw new NangoIntegrationError(code);
  }

  private async runInitialization(): Promise<void> {
    const checkedAt = this.dependencies.now();
    const nangoStatus = await this.dependencies.nango.initialize();
    let integrations: NangoIntegration[] = [];
    if (nangoStatus.state === 'available') {
      integrations = await this.dependencies.nango.listIntegrations();
    }

    for (const channelId of mailChannelIds) {
      const integrationKey = configuredKey(this.dependencies.environment, channelId);
      if (!integrationKey) {
        this.statuses.set(channelId, {
          state: 'unconfigured',
          checkedAt,
          errorCode: 'NANGO_CHANNEL_KEY_MISSING',
        });
        continue;
      }
      if (nangoStatus.state !== 'available') {
        this.statuses.set(channelId, {
          state: 'unavailable',
          checkedAt,
          errorCode: runtimeFailureCode(nangoStatus),
        });
        continue;
      }
      const integration = integrations.find(({ unique_key }) => unique_key === integrationKey);
      if (!integration) {
        this.statuses.set(channelId, {
          state: 'unavailable',
          checkedAt,
          errorCode: 'NANGO_INTEGRATION_NOT_FOUND',
        });
        continue;
      }
      const acceptedProviders = new Set(
        this.dependencies.getChannel(channelId).nangoProviders ?? [],
      );
      if (!acceptedProviders.has(integration.provider)) {
        this.statuses.set(channelId, {
          state: 'unavailable',
          checkedAt,
          errorCode: 'NANGO_PROVIDER_MISMATCH',
        });
        continue;
      }
      this.statuses.set(channelId, {
        state: 'available',
        checkedAt,
        errorCode: null,
      });
    }
  }
}

export const createNangoChannelIntegrationService = (
  dependencies: NangoChannelIntegrationDependencies,
): NangoChannelIntegrationService => new DefaultNangoChannelIntegrationService(dependencies);
