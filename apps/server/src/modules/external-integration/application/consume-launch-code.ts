import { digestExternalSecret, generateExternalSecret } from './create-access-grant';
import type { ExternalBrowserSession } from '../contracts/access';
import { ExternalIntegrationError } from '../errors';

export const EXTERNAL_BROWSER_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export type CreateExternalBrowserSessionRecord = {
  id: string;
  tokenDigest: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
};

export interface ExternalLaunchCodeConsumer {
  consumeGrant(input: {
    codeDigest: string;
    now: Date;
    session: CreateExternalBrowserSessionRecord;
  }): Promise<ExternalBrowserSession | null>;
}

export type ConsumeLaunchCodeDependencies = {
  repository: ExternalLaunchCodeConsumer;
  clock: {
    now(): Date;
  };
  nextId(): string;
  randomBytes(size: number): Uint8Array;
};

export const consumeLaunchCode = async (
  input: { launchCode: string },
  dependencies: ConsumeLaunchCodeDependencies,
): Promise<{
  sessionToken: string;
  session: ExternalBrowserSession;
}> => {
  const now = dependencies.clock.now();
  const sessionToken = generateExternalSecret(dependencies.randomBytes);
  const session = await dependencies.repository.consumeGrant({
    codeDigest: digestExternalSecret(input.launchCode),
    now,
    session: {
      id: dependencies.nextId(),
      tokenDigest: digestExternalSecret(sessionToken),
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + EXTERNAL_BROWSER_SESSION_TTL_MS),
    },
  });
  if (session === null) {
    throw new ExternalIntegrationError('LAUNCH_CODE_INVALID');
  }
  return {
    sessionToken,
    session,
  };
};
