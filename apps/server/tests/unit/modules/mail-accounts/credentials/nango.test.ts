import { describe, expect, it, vi } from 'vitest';

import {
  createNangoCredentialSnapshot,
  resolveNangoCredential,
  type NangoAuthorizationRecord,
  type NangoCredentialRepository,
  type NangoCredentialState,
} from '../../../../../src/modules/mail-accounts/credentials/nango';
import {
  decryptCredential,
  encryptCredential,
} from '../../../../../src/infrastructure/security/credential-encryption';
import type { NangoClient } from '../../../../../src/integrations/nango/client';

const encryptionKey = Buffer.alloc(32, 4).toString('base64');
const now = new Date('2026-07-24T12:00:00.000Z');

const authorization = (
  overrides: Partial<NangoAuthorizationRecord> = {},
): NangoAuthorizationRecord => ({
  id: 'binding-1',
  authSource: 'nango',
  encryptedCredentialSnapshot: null,
  accessTokenExpiresAt: null,
  nangoConnectionId: 'nango-connection-1',
  nangoProviderConfigKey: 'gmail-primary',
  ...overrides,
});

const createRepository = (initial: NangoCredentialState): NangoCredentialRepository => {
  let state = initial;
  return {
    refreshWithLock: vi.fn(async (_bindingId, refresh) => {
      state = await refresh(state);
      return state;
    }),
    invalidate: vi.fn(async () => {
      state = { encryptedCredentialSnapshot: null, accessTokenExpiresAt: null };
    }),
  };
};

const oauthConnection = (accessToken = 'fresh-access-token') => ({
  connection_id: 'nango-connection-1',
  provider_config_key: 'gmail-primary',
  provider: 'google-mail',
  metadata: null,
  tags: {},
  errors: [],
  credentials: {
    type: 'OAUTH2' as const,
    access_token: accessToken,
    expires_at: '2026-07-24T14:00:00.000Z',
    raw: {},
  },
});

describe('Nango credential resolution', () => {
  it('uses an encrypted OAuth access token outside the 15-minute safety window', async () => {
    const encryptedCredentialSnapshot = await encryptCredential(
      createNangoCredentialSnapshot({
        type: 'oauth2',
        accessToken: 'cached-access-token',
        scope: '',
      }),
      encryptionKey,
    );
    const state = {
      encryptedCredentialSnapshot,
      accessTokenExpiresAt: new Date('2026-07-24T13:00:00.000Z'),
    };
    const repository = createRepository(state);
    const client = { getConnection: vi.fn() } as unknown as NangoClient;

    await expect(
      resolveNangoCredential(authorization(state), encryptionKey, { client, repository }, now),
    ).resolves.toMatchObject({
      type: 'oauth2',
      accessToken: 'cached-access-token',
    });
    expect(client.getConnection).not.toHaveBeenCalled();
    expect(repository.refreshWithLock).not.toHaveBeenCalled();
  });

  it('fetches Nango when the access token expires within 15 minutes', async () => {
    const encryptedCredentialSnapshot = await encryptCredential(
      createNangoCredentialSnapshot({
        type: 'oauth2',
        accessToken: 'stale-access-token',
        scope: '',
      }),
      encryptionKey,
    );
    const state = {
      encryptedCredentialSnapshot,
      accessTokenExpiresAt: new Date('2026-07-24T12:14:59.000Z'),
    };
    const repository = createRepository(state);
    const client = {
      getConnection: vi.fn().mockResolvedValue(oauthConnection()),
    } as unknown as NangoClient;

    const result = await resolveNangoCredential(
      authorization(state),
      encryptionKey,
      { client, repository },
      now,
    );

    expect(result).toMatchObject({ accessToken: 'fresh-access-token' });
    expect(client.getConnection).toHaveBeenCalledWith('nango-connection-1', 'gmail-primary');
  });

  it('never requests a refresh token', async () => {
    const repository = createRepository({
      encryptedCredentialSnapshot: null,
      accessTokenExpiresAt: null,
    });
    const client = {
      getConnection: vi.fn().mockResolvedValue(oauthConnection()),
    } as unknown as NangoClient;

    await resolveNangoCredential(authorization(), encryptionKey, { client, repository }, now);

    expect(client.getConnection).toHaveBeenCalledWith('nango-connection-1', 'gmail-primary');
  });

  it('stores the refreshed access token and expiry atomically', async () => {
    const repository = createRepository({
      encryptedCredentialSnapshot: null,
      accessTokenExpiresAt: null,
    });
    const client = {
      getConnection: vi.fn().mockResolvedValue(oauthConnection()),
    } as unknown as NangoClient;

    await resolveNangoCredential(authorization(), encryptionKey, { client, repository }, now);

    const refresh = vi.mocked(repository.refreshWithLock).mock.calls[0]?.[1];
    expect(refresh).toBeTypeOf('function');
    const update = await refresh!({
      encryptedCredentialSnapshot: null,
      accessTokenExpiresAt: null,
    });
    await expect(
      decryptCredential(update.encryptedCredentialSnapshot!, encryptionKey),
    ).resolves.toMatchObject({ accessToken: 'fresh-access-token' });
    expect(update.accessTokenExpiresAt).toEqual(new Date('2026-07-24T14:00:00.000Z'));
  });

  it('deduplicates concurrent refreshes for one authorization binding', async () => {
    const repository = createRepository({
      encryptedCredentialSnapshot: null,
      accessTokenExpiresAt: null,
    });
    const client = {
      getConnection: vi.fn().mockResolvedValue(oauthConnection()),
    } as unknown as NangoClient;
    const input = authorization();

    await Promise.all([
      resolveNangoCredential(input, encryptionKey, { client, repository }, now),
      resolveNangoCredential(input, encryptionKey, { client, repository }, now),
    ]);

    expect(client.getConnection).toHaveBeenCalledTimes(1);
  });

  it('refetches Basic credentials after an authentication failure', async () => {
    const encryptedCredentialSnapshot = await encryptCredential(
      createNangoCredentialSnapshot({
        type: 'basic',
        username: 'cached-user',
        password: 'cached-password',
        host: 'imap.example.com',
        port: 993,
        secure: true,
      }),
      encryptionKey,
    );
    const state = { encryptedCredentialSnapshot, accessTokenExpiresAt: null };
    const repository = createRepository(state);
    const client = {
      getConnection: vi.fn().mockResolvedValue({
        ...oauthConnection(),
        credentials: {
          type: 'BASIC',
          username: 'fresh-user',
          password: 'fresh-password',
          raw: { host: 'imap.example.com', port: 993, secure: true },
        },
      }),
    } as unknown as NangoClient;

    const result = await resolveNangoCredential(
      authorization(state),
      encryptionKey,
      { client, repository, forceRefresh: true },
      now,
    );

    expect(result).toMatchObject({ type: 'basic', username: 'fresh-user' });
    expect(client.getConnection).toHaveBeenCalledTimes(1);
  });

  it('uses a still-valid cached token when Nango is temporarily unavailable', async () => {
    const encryptedCredentialSnapshot = await encryptCredential(
      createNangoCredentialSnapshot({
        type: 'oauth2',
        accessToken: 'cached-access-token',
        scope: '',
      }),
      encryptionKey,
    );
    const state = {
      encryptedCredentialSnapshot,
      accessTokenExpiresAt: new Date('2026-07-24T12:10:00.000Z'),
    };
    const repository = createRepository(state);
    const client = {
      getConnection: vi.fn().mockRejectedValue(new Error('Nango unavailable')),
    } as unknown as NangoClient;

    await expect(
      resolveNangoCredential(authorization(state), encryptionKey, { client, repository }, now),
    ).resolves.toMatchObject({
      accessToken: 'cached-access-token',
    });
  });
});
