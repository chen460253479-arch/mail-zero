import type { MailChannelDescriptor, MailChannelId } from '../../../mail-channel/contracts';
import type { NangoIntegration } from '../../../integrations/nango/schemas';

export type AvailableNangoChannel = {
  channelId: MailChannelId;
  displayName: string;
  integrations: Array<{
    integrationId: string;
    displayName: string;
  }>;
};

export const listAvailableNangoChannels = (
  integrations: readonly NangoIntegration[],
  channels: readonly MailChannelDescriptor[],
): AvailableNangoChannel[] =>
  channels
    .flatMap((channel) => {
      const providers = new Set(channel.nangoProviders ?? []);
      const matchingIntegrations = integrations
        .filter(({ provider }) => providers.has(provider))
        .map(({ unique_key, display_name }) => ({
          integrationId: unique_key,
          displayName: display_name,
        }))
        .sort((left, right) => left.integrationId.localeCompare(right.integrationId));

      if (matchingIntegrations.length === 0) return [];
      return [
        {
          channelId: channel.id,
          displayName: channel.displayName,
          integrations: matchingIntegrations,
        },
      ];
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
