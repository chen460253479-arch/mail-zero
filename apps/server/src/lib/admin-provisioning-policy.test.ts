import { describe, expect, it } from 'vitest';

import {
  parseAdminProvisioningConfig,
  validateAdminCredentials,
} from './admin-provisioning-policy';

describe('parseAdminProvisioningConfig', () => {
  it('keeps automatic provisioning disabled unless explicitly enabled', () => {
    expect(parseAdminProvisioningConfig({ ZERO_ADMIN_AUTO_PROVISION: 'false' })).toBeNull();
  });

  it('requires every administrator credential when automatic provisioning is enabled', () => {
    expect(() =>
      parseAdminProvisioningConfig({
        ZERO_ADMIN_AUTO_PROVISION: 'true',
        ZERO_ADMIN_EMAIL: 'admin@example.com',
      }),
    ).toThrow('ZERO_ADMIN_NAME');
  });

  it('normalizes the configured administrator account', () => {
    expect(
      parseAdminProvisioningConfig({
        ZERO_ADMIN_AUTO_PROVISION: 'true',
        ZERO_ADMIN_NAME: '  Zero Admin  ',
        ZERO_ADMIN_EMAIL: '  ADMIN@EXAMPLE.COM ',
        ZERO_ADMIN_PASSWORD: 'correct horse battery staple',
      }),
    ).toEqual({
      name: 'Zero Admin',
      email: 'admin@example.com',
      password: 'correct horse battery staple',
    });
  });
});

describe('validateAdminCredentials', () => {
  it('rejects invalid email addresses', () => {
    expect(() =>
      validateAdminCredentials({
        name: 'Admin',
        email: 'not-an-email',
        password: 'correct horse battery staple',
      }),
    ).toThrow('valid email');
  });

  it('requires a strong password', () => {
    expect(() =>
      validateAdminCredentials({
        name: 'Admin',
        email: 'admin@example.com',
        password: 'short',
      }),
    ).toThrow('at least 12 characters');
  });
});
