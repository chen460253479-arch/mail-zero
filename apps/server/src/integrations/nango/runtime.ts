import { createNangoIntegrationService, type NangoIntegrationService } from './service';
import type { ZeroEnv } from '../../env';

type NangoEnvironment = Pick<ZeroEnv, 'NANGO_BASE_URL' | 'NANGO_SECRET_KEY'>;
type NangoExecutionContext = Pick<ExecutionContext, 'waitUntil'>;

let service: NangoIntegrationService | undefined;

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

export const startNangoValidationForEnvironment = (
  environment: NangoEnvironment,
  executionContext: NangoExecutionContext,
): void => {
  executionContext.waitUntil(getNangoServiceForEnvironment(environment).initialize());
};
