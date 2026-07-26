import { describe, expect, it } from 'vitest';

import { assertAdministrator, IntegrationPermissionError } from './permissions';

describe('integration administrator permissions', () => {
  it('rejects a non-admin session', () => {
    expect(() => assertAdministrator({ role: 'user' })).toThrowError(
      new IntegrationPermissionError('ADMIN_REQUIRED'),
    );
  });

  it('rejects a session without an explicit role', () => {
    expect(() => assertAdministrator({})).toThrowError(
      new IntegrationPermissionError('ADMIN_REQUIRED'),
    );
  });

  it('accepts an administrator session', () => {
    expect(() => assertAdministrator({ role: 'admin' })).not.toThrow();
  });
});
