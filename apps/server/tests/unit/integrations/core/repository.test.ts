import { describe, expect, it } from 'vitest';

import { parsePublicConfig, toSafeIntegration } from '../../../../src/integrations/core/repository';

describe('system integration repository', () => {
  it('parses public configuration by integration key', () => {
    expect(parsePublicConfig('gmail_zero_oauth', { clientId: 'client-id' })).toEqual({
      clientId: 'client-id',
    });
  });

  it('rejects public configuration for the wrong integration key', () => {
    expect(() =>
      parsePublicConfig('gmail_zero_oauth', { baseUrl: 'https://api.nango.dev' }),
    ).toThrow();
  });

  it('returns a safe record without encrypted secret material', () => {
    const validatedAt = new Date('2026-07-24T08:00:00.000Z');
    const safe = toSafeIntegration({
      id: 'integration-1',
      integrationKey: 'gmail_zero_oauth',
      publicConfig: { clientId: 'client-id' },
      encryptedSecret: 'ciphertext',
      status: 'active',
      validatedAt,
      updatedBy: 'admin-1',
      createdAt: validatedAt,
      updatedAt: validatedAt,
    });

    expect(safe).toEqual({
      configured: true,
      key: 'gmail_zero_oauth',
      publicConfig: { clientId: 'client-id' },
      secretConfigured: true,
      status: 'active',
      validatedAt,
    });
    expect(safe).not.toHaveProperty('encryptedSecret');
  });
});
