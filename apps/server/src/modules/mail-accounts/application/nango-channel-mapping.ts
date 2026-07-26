import type { SystemIntegrationRepository } from '../../../integrations/core/repository';
import type { NangoIntegration } from '../../../integrations/nango/schemas';
import { NangoIntegrationError } from '../../../integrations/nango/errors';
import type { MailChannelId } from '../../../mail-channel/contracts';

type NangoChannelDescriptor = {
  id: MailChannelId;
  nangoProviders?: readonly string[];
};

type NangoChannelMappingDependencies = {
  repository: SystemIntegrationRepository;
  listIntegrations(): Promise<NangoIntegration[]>;
  getChannel(channelId: MailChannelId): NangoChannelDescriptor;
};

export class NangoChannelMappingService {
  constructor(private readonly dependencies: NangoChannelMappingDependencies) {}

  async listIntegrations(channelId: MailChannelId): Promise<NangoIntegration[]> {
    const providers = new Set(this.dependencies.getChannel(channelId).nangoProviders ?? []);
    return (await this.dependencies.listIntegrations()).filter(({ provider }) =>
      providers.has(provider),
    );
  }

  async setMapping(channelId: MailChannelId, integrationId: string): Promise<void> {
    const current = await this.dependencies.repository.getMapping(channelId, 'nango');
    if (current?.externalIntegrationId === integrationId) return;
    if (
      current &&
      (await this.dependencies.repository.countNangoBindings(current.externalIntegrationId)) > 0
    ) {
      throw new NangoIntegrationError('INTEGRATION_IN_USE');
    }

    const integrations = await this.listIntegrations(channelId);
    if (!integrations.some(({ unique_key }) => unique_key === integrationId)) {
      throw new NangoIntegrationError('NANGO_INTEGRATION_UNAVAILABLE');
    }
    await this.dependencies.repository.setMapping(channelId, 'nango', integrationId);
  }
}
