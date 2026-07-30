import { describe, expect, it, vi } from 'vitest';

import { submitPasswordChange } from './change-password-client';

describe('first password change submission', () => {
  it('updates the password and enters the normal mailbox UI', async () => {
    const changePassword = vi.fn(async () => ({ success: true }));
    const navigate = vi.fn();

    await submitPasswordChange(
      {
        currentPassword: 'user_200',
        newPassword: 'new-secure-password',
      },
      { changePassword, navigate },
    );

    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'user_200',
      newPassword: 'new-secure-password',
    });
    expect(navigate).toHaveBeenCalledWith('/mail/inbox', { replace: true });
  });

  it('does not navigate when the password mutation fails', async () => {
    const changePassword = vi.fn(async () => {
      throw new Error('INVALID_PASSWORD');
    });
    const navigate = vi.fn();

    await expect(
      submitPasswordChange(
        {
          currentPassword: 'wrong-password',
          newPassword: 'new-secure-password',
        },
        { changePassword, navigate },
      ),
    ).rejects.toThrow('INVALID_PASSWORD');
    expect(navigate).not.toHaveBeenCalled();
  });
});
