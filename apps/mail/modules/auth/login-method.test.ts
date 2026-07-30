import { describe, expect, it } from 'vitest';

import { requiresInitialPasswordChange, resolveLoginMethod } from './login-method';

describe('managed user login selection', () => {
  it('uses email login for administrators and Username login for managed users', () => {
    expect(resolveLoginMethod('admin@example.test')).toBe('email');
    expect(resolveLoginMethod('user_200')).toBe('username');
  });

  it('requires the change page only for an initial-password ordinary Session', () => {
    expect(
      requiresInitialPasswordChange({
        user: { role: 'user', mustChangePassword: true },
        session: { authMethod: 'password' },
      }),
    ).toBe(true);
    expect(
      requiresInitialPasswordChange({
        user: { role: 'user', mustChangePassword: true },
        session: { authMethod: 'launch' },
      }),
    ).toBe(false);
    expect(
      requiresInitialPasswordChange({
        user: { role: 'admin', mustChangePassword: true },
        session: { authMethod: 'password' },
      }),
    ).toBe(false);
  });
});
