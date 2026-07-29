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
type NangoExecutionContext = Pick<ExecutionContext, 'waitUntil'>;

let service: NangoIntegrationService | undefined;
let channels: NangoChannelIntegrationService | undefined;

export const getNangoServiceForEnvironment = (
  environment: NangoEnvironment,
): NangoIntegrationService => {
  service ??= createNangoIntegrationService({
    baseUrl: environment.NANGO_BASE_URL,
    secretKey: environment.NANGO_SECRET_KEY,
    fetch,
    now: () => new Date(),
  });
  return service;
};

export const getNangoChannelServiceForEnvironment = (
  environment: NangoEnvironment,
): NangoChannelIntegrationService => {
  channels ??= createNangoChannelIntegrationService({
    environment,
    nango: getNangoServiceForEnvironment(environment),
    getChannel: (channelId) => defaultMailChannelRegistry.get(channelId),
    now: () => new Date(),
  });
  return channels;
};

export const startNangoValidationForEnvironment = (
  environment: NangoEnvironment,
  executionContext: NangoExecutionContext,
): void => {
  executionContext.waitUntil(getNangoChannelServiceForEnvironment(environment).initialize());
};
