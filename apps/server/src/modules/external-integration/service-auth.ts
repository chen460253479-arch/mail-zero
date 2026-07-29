import { createHash, timingSafeEqual } from 'node:crypto';

export class ExternalIntegrationAuthError extends Error {
  readonly code = 'INTEGRATION_UNAUTHORIZED';

  constructor() {
    super('INTEGRATION_UNAUTHORIZED');
    this.name = 'ExternalIntegrationAuthError';
  }
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

export const requireIntegrationServiceToken = (
  configuredToken: string | undefined,
  authorizationHeader: string | undefined,
): void => {
  const suppliedToken = authorizationHeader?.match(/^Bearer (.+)$/u)?.[1];
  if (
    configuredToken === undefined ||
    suppliedToken === undefined ||
    !timingSafeEqual(digest(configuredToken), digest(suppliedToken))
  ) {
    throw new ExternalIntegrationAuthError();
  }
};
