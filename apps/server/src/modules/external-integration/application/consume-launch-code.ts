import { digestExternalSecret } from './create-access-grant';
import { ExternalIntegrationError } from '../errors';

export interface ExternalLaunchCodeConsumer {
  consumeGrant(input: { codeDigest: string; now: Date }): Promise<{ userId: string } | null>;
}

export type ConsumeLaunchCodeDependencies = {
  repository: ExternalLaunchCodeConsumer;
  clock: {
    now(): Date;
  };
};

export const consumeLaunchCode = async (
  input: { launchCode: string },
  dependencies: ConsumeLaunchCodeDependencies,
): Promise<{ userId: string }> => {
  const now = dependencies.clock.now();
  const grant = await dependencies.repository.consumeGrant({
    codeDigest: digestExternalSecret(input.launchCode),
    now,
  });
  if (grant === null) {
    throw new ExternalIntegrationError('LAUNCH_CODE_INVALID');
  }
  return grant;
};
