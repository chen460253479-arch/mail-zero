import { describe, expect, it, vi } from 'vitest';

import {
  EXTERNAL_SESSION_RENEW_AFTER_MS,
  resolveExternalBrowserSession,
} from '../../../../../src/modules/external-integration/session/resolve';
import { EXTERNAL_BROWSER_SESSION_TTL_MS } from '../../../../../src/modules/external-integration/application/consume-launch-code';
import { digestExternalSecret } from '../../../../../src/modules/external-integration/application/create-access-grant';

const now = new Date('2026-07-29T10:00:00.000Z');

const session = {
  id: 'external-session-1',
  ownerUserId: 'zero-external-integration' as const,
  scopes: [
    {
      nangoConnectionId: 'connect-gmail-1',
      connectionId: 'connection-gmail-1',
      mailAccountId: 'account-gmail-1',
    },
  ],
  activeConnectionId: 'connection-gmail-1',
  updatedAt: new Date(now.getTime() - EXTERNAL_SESSION_RENEW_AFTER_MS),
  expiresAt: new Date('2026-08-20T10:00:00.000Z'),
};

describe('resolveExternalBrowserSession', () => {
  it('looks up the session by digest and renews it every three days', async () => {
    const renewed = {
      ...session,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + EXTERNAL_BROWSER_SESSION_TTL_MS),
    };
    const repository = {
      findSessionByDigest: vi.fn(async () => session),
      renewSession: vi.fn(async () => renewed),
    };

    await expect(
      resolveExternalBrowserSession('raw-session-token', {
        repository,
        clock: { now: () => now },
      }),
    ).resolves.toEqual(renewed);

    expect(repository.findSessionByDigest).toHaveBeenCalledWith({
      tokenDigest: digestExternalSecret('raw-session-token'),
      now,
    });
    expect(repository.renewSession).toHaveBeenCalledWith({
      id: 'external-session-1',
      now,
      expiresAt: new Date(now.getTime() + EXTERNAL_BROWSER_SESSION_TTL_MS),
    });
  });

  it('does not renew a recently updated session', async () => {
    const current = {
      ...session,
      updatedAt: new Date(now.getTime() - EXTERNAL_SESSION_RENEW_AFTER_MS + 1),
    };
    const repository = {
      findSessionByDigest: vi.fn(async () => current),
      renewSession: vi.fn(),
    };

    await expect(
      resolveExternalBrowserSession('raw-session-token', {
        repository,
        clock: { now: () => now },
      }),
    ).resolves.toEqual(current);
    expect(repository.renewSession).not.toHaveBeenCalled();
  });

  it('returns null for missing, expired, or empty session tokens', async () => {
    const repository = {
      findSessionByDigest: vi.fn(async () => null),
      renewSession: vi.fn(),
    };

    await expect(
      resolveExternalBrowserSession(undefined, {
        repository,
        clock: { now: () => now },
      }),
    ).resolves.toBeNull();
    await expect(
      resolveExternalBrowserSession('expired-token', {
        repository,
        clock: { now: () => now },
      }),
    ).resolves.toBeNull();
    expect(repository.findSessionByDigest).toHaveBeenCalledOnce();
  });
});
