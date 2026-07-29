import { describe, expect, it, vi } from 'vitest';

import {
  consumeLaunchCode,
  EXTERNAL_BROWSER_SESSION_TTL_MS,
} from '../../../../../src/modules/external-integration/application/consume-launch-code';
import { digestExternalSecret } from '../../../../../src/modules/external-integration/application/create-access-grant';

const now = new Date('2026-07-29T10:00:00.000Z');
const launchCode = 'one-time-launch-code';
const scopes = [
  {
    nangoConnectionId: 'connect-gmail-1',
    connectionId: 'connection-gmail-1',
    mailAccountId: 'account-gmail-1',
  },
  {
    nangoConnectionId: 'connect-outlook-1',
    connectionId: 'connection-outlook-1',
    mailAccountId: 'account-outlook-1',
  },
];

const createDependencies = () => {
  let consumed = false;
  const consumeGrant = vi.fn(async (input) => {
    if (consumed) return null;
    consumed = true;
    return {
      id: input.session.id,
      ownerUserId: 'zero-external-integration' as const,
      scopes,
      activeConnectionId: scopes[0]!.connectionId,
      expiresAt: input.session.expiresAt,
      updatedAt: input.session.updatedAt,
    };
  });
  return {
    consumeGrant,
    dependencies: {
      repository: { consumeGrant },
      clock: { now: () => now },
      nextId: () => 'external-session-1',
      randomBytes: (size: number) => new Uint8Array(size).fill(13),
    },
  };
};

describe('consumeLaunchCode', () => {
  it('consumes a launch code once and creates a scoped session', async () => {
    const { consumeGrant, dependencies } = createDependencies();

    const first = await consumeLaunchCode({ launchCode }, dependencies);

    expect(first.session.scopes).toEqual(scopes);
    expect(first.session.activeConnectionId).toBe('connection-gmail-1');
    expect(first.session.expiresAt).toEqual(
      new Date(now.getTime() + EXTERNAL_BROWSER_SESSION_TTL_MS),
    );
    expect(consumeGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        codeDigest: digestExternalSecret(launchCode),
        now,
        session: expect.objectContaining({
          id: 'external-session-1',
          tokenDigest: expect.any(String),
        }),
      }),
    );
    expect(consumeGrant.mock.calls[0]![0].session.tokenDigest).not.toBe(first.sessionToken);

    await expect(consumeLaunchCode({ launchCode }, dependencies)).rejects.toMatchObject({
      code: 'LAUNCH_CODE_INVALID',
    });
  });

  it('rejects an expired launch code reported by the repository', async () => {
    const dependencies = {
      repository: {
        consumeGrant: vi.fn(async () => null),
      },
      clock: { now: () => now },
      nextId: () => 'external-session-1',
      randomBytes: (size: number) => new Uint8Array(size).fill(19),
    };

    await expect(consumeLaunchCode({ launchCode }, dependencies)).rejects.toMatchObject({
      code: 'LAUNCH_CODE_INVALID',
    });
  });
});
