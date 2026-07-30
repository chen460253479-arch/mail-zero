import { describe, expect, it, vi } from 'vitest';

import { requiresPasswordChange } from '../../../../src/trpc/trpc';
import { userRouter } from '../../../../src/trpc/routes/user';

const user = {
  id: 'managed-user-1',
  username: 'user_200',
  role: 'user',
  mustChangePassword: true,
};

const session = {
  id: 'session-1',
  userId: user.id,
  authMethod: 'password',
};

const createCaller = (options: {
  changePassword?: ReturnType<typeof vi.fn>;
  updateUser?: ReturnType<typeof vi.fn>;
} = {}) => {
  const changePassword =
    options.changePassword ?? vi.fn(async () => ({ token: 'updated-session-token' }));
  const updateUser = options.updateUser ?? vi.fn(async () => undefined);
  const services = {
    userWorkspace: {
      forUser: () => ({ updateUser }),
    },
  };
  const auth = { api: { changePassword } };
  return {
    changePassword,
    updateUser,
    caller: userRouter.createCaller({
      c: {
        var: { auth, services },
        req: { raw: { headers: new Headers() } },
      } as never,
      auth: auth as never,
      services: services as never,
      sessionUser: user as never,
      authSession: session as never,
    }),
  };
};

describe('password-change gate', () => {
  it('blocks only an initial-password ordinary Session', () => {
    expect(
      requiresPasswordChange({
        user: { role: 'user', mustChangePassword: true },
        session: { authMethod: 'password' },
      }),
    ).toBe(true);
    expect(
      requiresPasswordChange({
        user: { role: 'user', mustChangePassword: true },
        session: { authMethod: 'launch' },
      }),
    ).toBe(false);
    expect(
      requiresPasswordChange({
        user: { role: 'user', mustChangePassword: false },
        session: { authMethod: 'password' },
      }),
    ).toBe(false);
    expect(
      requiresPasswordChange({
        user: { role: 'admin', mustChangePassword: true },
        session: { authMethod: 'password' },
      }),
    ).toBe(false);
  });
});

describe('user.changePassword', () => {
  it('changes the credential before clearing the first-password flag', async () => {
    const { caller, changePassword, updateUser } = createCaller();

    await expect(
      caller.changePassword({
        currentPassword: 'user_200',
        newPassword: 'new-secure-password',
      }),
    ).resolves.toEqual({ success: true });

    expect(changePassword).toHaveBeenCalledWith({
      body: {
        currentPassword: 'user_200',
        newPassword: 'new-secure-password',
        revokeOtherSessions: false,
      },
      headers: expect.any(Headers),
    });
    expect(updateUser).toHaveBeenCalledWith({
      mustChangePassword: false,
      updatedAt: expect.any(Date),
    });
    expect(changePassword.mock.invocationCallOrder[0]).toBeLessThan(
      updateUser.mock.invocationCallOrder[0]!,
    );
  });

  it('rejects a new password equal to the external username', async () => {
    const { caller, changePassword, updateUser } = createCaller();

    await expect(
      caller.changePassword({
        currentPassword: 'old-password',
        newPassword: 'user_200',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(changePassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('does not clear the flag when Better Auth rejects the current password', async () => {
    const changePassword = vi.fn(async () => {
      throw new Error('INVALID_PASSWORD');
    });
    const { caller, updateUser } = createCaller({ changePassword });

    await expect(
      caller.changePassword({
        currentPassword: 'wrong-password',
        newPassword: 'new-secure-password',
      }),
    ).rejects.toThrow('INVALID_PASSWORD');
    expect(updateUser).not.toHaveBeenCalled();
  });
});
