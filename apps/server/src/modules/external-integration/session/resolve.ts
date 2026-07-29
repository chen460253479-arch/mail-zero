import { EXTERNAL_BROWSER_SESSION_TTL_MS } from '../application/consume-launch-code';
import { digestExternalSecret } from '../application/create-access-grant';
import type { ExternalBrowserSession } from '../contracts/access';

export const EXTERNAL_SESSION_RENEW_AFTER_MS = 3 * 24 * 60 * 60_000;

export interface ExternalSessionRepository {
  findSessionByDigest(input: {
    tokenDigest: string;
    now: Date;
  }): Promise<ExternalBrowserSession | null>;
  renewSession(input: {
    id: string;
    now: Date;
    expiresAt: Date;
  }): Promise<ExternalBrowserSession | null>;
}

export const resolveExternalBrowserSession = async (
  sessionToken: string | undefined,
  dependencies: {
    repository: ExternalSessionRepository;
    clock: {
      now(): Date;
    };
  },
): Promise<ExternalBrowserSession | null> => {
  if (sessionToken === undefined || sessionToken.length === 0) {
    return null;
  }
  const now = dependencies.clock.now();
  const session = await dependencies.repository.findSessionByDigest({
    tokenDigest: digestExternalSecret(sessionToken),
    now,
  });
  if (session === null) return null;
  if (now.getTime() - session.updatedAt.getTime() < EXTERNAL_SESSION_RENEW_AFTER_MS) {
    return session;
  }
  return await dependencies.repository.renewSession({
    id: session.id,
    now,
    expiresAt: new Date(now.getTime() + EXTERNAL_BROWSER_SESSION_TTL_MS),
  });
};
