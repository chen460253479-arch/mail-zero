import { describe, expect, it } from 'vitest';

import { encryptCredential } from './encryption';
import { createZeroOAuthSnapshot } from './zero-oauth';
import { resolveConnectionCredential, type ConnectionCredentialRecord } from './resolve';

const encryptionKey = Buffer.alloc(32, 9).toString('base64');

const createRecord = (
  overrides: Partial<ConnectionCredentialRecord> = {},
): ConnectionCredentialRecord => ({
  connection: { status: 'connected' },
  authorization: {
    authSource: 'zero_oauth',
    encryptedCredentialSnapshot: null,
    accessTokenExpiresAt: new Date('2026-07-24T00:00:00.000Z'),
  },
  ...overrides,
});

describe('connection credential resolution', () => {
  it('resolves zero_oauth through the encrypted snapshot', async () => {
    const encryptedCredentialSnapshot = await encryptCredential(
      createZeroOAuthSnapshot({
        accessToken: 'access',
        refreshToken: 'refresh',
        scope: 'mail',
      }),
      encryptionKey,
    );
    const record = createRecord({
      authorization: {
        authSource: 'zero_oauth',
        encryptedCredentialSnapshot,
        accessTokenExpiresAt: new Date('2026-07-24T00:00:00.000Z'),
      },
    });

    await expect(resolveConnectionCredential(record, encryptionKey)).resolves.toEqual({
      type: 'oauth2',
      accessToken: 'access',
      refreshToken: 'refresh',
      scope: 'mail',
      expiresAt: new Date('2026-07-24T00:00:00.000Z'),
    });
  });

  it('rejects a disconnected mailbox', async () => {
    const record = createRecord({ connection: { status: 'disconnected' } });

    await expect(resolveConnectionCredential(record, encryptionKey)).rejects.toThrow(
      'Mailbox is disconnected',
    );
  });

  it('rejects a mailbox without an authorization binding', async () => {
    const record = createRecord({ authorization: null });

    await expect(resolveConnectionCredential(record, encryptionKey)).rejects.toThrow(
      'Mailbox authorization is missing',
    );
  });

  it('rejects an auth source that has no registered resolver', async () => {
    const record = createRecord({
      authorization: {
        authSource: 'nango',
        encryptedCredentialSnapshot: 'unused',
        accessTokenExpiresAt: null,
      },
    });

    await expect(resolveConnectionCredential(record, encryptionKey)).rejects.toThrow(
      'Unsupported authorization source: nango',
    );
  });
});
