import { describe, expect, it } from 'vitest';

import { parsePublicConfig, toSafeIntegration } from './repository';

describe('system integration repository contracts', () => {
  it('parses public configuration by integration key', () => {
    expect(parsePublicConfig('nango', { baseUrl: 'https://api.nango.dev' })).toEqual({
      baseUrl: 'https://api.nango.dev',
    });
    expect(parsePublicConfig('gmail_zero_oauth', { clientId: 'client-id' })).toEqual({
      clientId: 'client-id',
    });
  });

  it('rejects public configuration for the wrong integration key', () => {
    expect(() => parsePublicConfig('nango', { clientId: 'client-id' })).toThrow();
    expect(() =>
      parsePublicConfig('gmail_zero_oauth', { baseUrl: 'https://api.nango.dev' }),
    ).toThrow();
  });

  it('returns a safe record without encrypted secret material', () => {
    const validatedAt = new Date('2026-07-24T08:00:00.000Z');
    const safe = toSafeIntegration({
      id: 'integration-1',
      integrationKey: 'nango',
      publicConfig: { baseUrl: 'https://api.nango.dev' },
      encryptedSecret: 'ciphertext',
      status: 'active',
      validatedAt,
      updatedBy: 'admin-1',
      createdAt: validatedAt,
      updatedAt: validatedAt,
    });

    expect(safe).toEqual({
      configured: true,
      key: 'nango',
      publicConfig: { baseUrl: 'https://api.nango.dev' },
      secretConfigured: true,
      status: 'active',
      validatedAt,
    });
    expect(safe).not.toHaveProperty('encryptedSecret');
  });
});
