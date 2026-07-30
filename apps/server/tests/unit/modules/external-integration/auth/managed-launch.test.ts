import { beforeEach, describe, expect, it, vi } from 'vitest';

import { managedLaunch } from '../../../../../src/modules/external-integration/auth/managed-launch';

const setSessionCookie = vi.hoisted(() => vi.fn());

vi.mock('better-auth/cookies', () => ({
  setSessionCookie,
}));

const user = {
  id: 'managed-user-1',
  email: 'managed@example.test',
  emailVerified: true,
  name: 'user_200',
  createdAt: new Date('2026-07-30T10:00:00.000Z'),
  updatedAt: new Date('2026-07-30T10:00:00.000Z'),
};

describe('managed Launch Better Auth plugin', () => {
  beforeEach(() => {
    setSessionCookie.mockReset();
  });

  it('exchanges a code for a standard launch-method session and a fixed redirect', async () => {
    const consumeLaunchCode = vi.fn(async () => ({ userId: user.id }));
    const session = {
      id: 'session-1',
      userId: user.id,
      token: 'standard-session-token',
      expiresAt: new Date('2026-08-29T10:00:00.000Z'),
      createdAt: new Date('2026-07-30T10:00:00.000Z'),
      updatedAt: new Date('2026-07-30T10:00:00.000Z'),
    };
    const createSession = vi.fn(async () => session);
    const findUserById = vi.fn(async () => user);
    const plugin = managedLaunch({
      consumeLaunchCode,
      publicAppUrl: 'https://mail.zero.example.test',
    });

    const response = (await plugin.endpoints.consumeManagedLaunch({
      body: { launchCode: 'one-time-code' },
      context: {
        internalAdapter: {
          createSession,
          findUserById,
        },
      },
      asResponse: true,
    } as never)) as unknown as Response;

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://mail.zero.example.test/mail/inbox');
    expect(consumeLaunchCode).toHaveBeenCalledWith({ launchCode: 'one-time-code' });
    expect(findUserById).toHaveBeenCalledWith(user.id);
    expect(createSession).toHaveBeenCalledWith(user.id, expect.anything(), false, {
      authMethod: 'launch',
    });
    expect(setSessionCookie).toHaveBeenCalledWith(expect.anything(), { session, user }, false);
  });

  it('does not create a session for an invalid launch code', async () => {
    const consumeLaunchCode = vi.fn(async () => {
      throw Object.assign(new Error('LAUNCH_CODE_INVALID'), {
        code: 'LAUNCH_CODE_INVALID',
      });
    });
    const createSession = vi.fn();
    const plugin = managedLaunch({
      consumeLaunchCode,
      publicAppUrl: 'https://mail.zero.example.test',
    });

    const response = (await plugin.endpoints.consumeManagedLaunch({
      body: { launchCode: 'invalid-code' },
      context: {
        internalAdapter: {
          createSession,
          findUserById: vi.fn(),
        },
      },
      asResponse: true,
    } as never)) as unknown as Response;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'LAUNCH_CODE_INVALID',
    });
    expect(createSession).not.toHaveBeenCalled();
  });
});
