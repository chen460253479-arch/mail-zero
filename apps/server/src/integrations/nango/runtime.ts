import {
  createNangoChannelIntegrationService,
  type NangoChannelEnvironment,
  type NangoChannelIntegrationService,
} from './channels';
import { createNangoIntegrationService, type NangoIntegrationService } from './service';
import { defaultMailChannelRegistry } from '../../mail-channel/registry';
import type { ZeroEnv } from '../../env';

export type NangoEnvironment = Pick<ZeroEnv, 'NANGO_BASE_URL' | 'NANGO_SECRET_KEY'> &
  NangoChannelEnvironment;

export type NangoRuntime = {
  service: NangoIntegrationService;
  channels: NangoChannelIntegrationService;
  initialize(): Promise<void>;
};

export const createNangoRuntime = (environment: NangoEnvironment): NangoRuntime => {
  const service = createNangoIntegrationService({
    baseUrl: environment.NANGO_BASE_URL,
    secretKey: environment.NANGO_SECRET_KEY,
    fetch,
    now: () => new Date(),
  });
  const channels = createNangoChannelIntegrationService({
    environment,
    nango: service,
    getChannel: (channelId) => defaultMailChannelRegistry.get(channelId),
    now: () => new Date(),
  });

  return {
    service,
    channels,
    initialize: async () => await channels.initialize(),
  };
};
