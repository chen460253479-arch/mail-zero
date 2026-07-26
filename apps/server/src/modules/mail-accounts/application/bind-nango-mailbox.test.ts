import { describe, expect, it, vi } from 'vitest';

import {
  bindNangoMailbox,
  listSafeNangoConnections,
  NangoBindingError,
  type NangoBindingRepository,
} from './bind-nango-mailbox';
import { decryptCredential } from '../../../infrastructure/security/credential-encryption';
import type { MailChannelPlugin } from '../../../mail-channel/contracts';
import type { NangoClient } from '../../../integrations/nango/client';

const encryptionKey = Buffer.alloc(32, 6).toString('base64');

const connection = {
  connection_id: 'nango-1',
  provider_config_key: 'gmail-primary',
  provider: 'google-mail',
  metadata: null,
  tags: {},
  errors: [],
  credentials: {
    type: 'OAUTH2' as const,
    access_token: 'nango-access-token',
    expires_at: '2026-07-24T15:00:00.000Z',
    raw: { refresh_token: 'must-not-store' },
  },
};

const createChannel = () =>
  ({
    id: 'gmail',
    providerKey: 'gmail',
    displayName: 'Gmail',
    nangoProviders: ['google-mail'],
    capabilities: new Set(),
    credentialTypes: new Set(['oauth2']),
    resolveIdentity: vi.fn().mockResolvedValue({
      email: 'Owner@Example.com',
      name: 'Mailbox Owner',
      picture: 'https://example.com/avatar.png',
    }),
  }) satisfies MailChannelPlugin;

const createRepository = (): NangoBindingRepository => ({
  findMailboxByNormalizedEmail: vi.fn().mockResolvedValue(null),
  findByNangoReference: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue({ id: 'zero-mailbox-1' }),
});

const createDependencies = () => {
  const channel = createChannel();
  const repository = createRepository();
  return {
    channel,
    repository,
    dependencies: {
      client: { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as NangoClient,
      getChannel: vi.fn().mockReturnValue(channel),
      isIntegrationAvailable: vi.fn().mockResolvedValue(true),
      repository,
      encryptionKey,
      now: () => new Date('2026-07-24T12:00:00.000Z'),
    },
  };
};

const input = {
  userId: 'user-1',
  channelId: 'gmail' as const,
  integrationId: 'gmail-primary',
  connectionId: 'nango-1',
};

describe('Nango mailbox binding', () => {
  it('verifies the mailbox identity through the selected channel', async () => {
    const { channel, repository, dependencies } = createDependencies();

    await bindNangoMailbox(input, dependencies);

    expect(channel.resolveIdentity).toHaveBeenCalledWith({
      credential: {
        type: 'oauth2',
        accessToken: 'nango-access-token',
        expiresAt: new Date('2026-07-24T15:00:00.000Z'),
        scope: '',
      },
    });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        mailbox: expect.objectContaining({
          email: 'Owner@Example.com',
          normalizedEmail: 'owner@example.com',
          channelId: 'gmail',
        }),
      }),
    );
  });

  it('rejects an already-connected normalized email', async () => {
    const { repository, dependencies } = createDependencies();
    vi.mocked(repository.findMailboxByNormalizedEmail).mockResolvedValue({
      id: 'existing',
      channelId: 'gmail',
      status: 'connected',
    });

    await expect(bindNangoMailbox(input, dependencies)).rejects.toMatchObject({
      code: 'MAILBOX_ALREADY_CONNECTED',
    } satisfies Partial<NangoBindingError>);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('reuses a disconnected mailbox only when email and channel both match', async () => {
    const { repository, dependencies } = createDependencies();
    vi.mocked(repository.findMailboxByNormalizedEmail).mockResolvedValue({
      id: 'existing',
      channelId: 'gmail',
      status: 'disconnected',
    });

    await bindNangoMailbox(input, dependencies);

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ existingMailboxId: 'existing' }),
    );

    vi.mocked(repository.findMailboxByNormalizedEmail).mockResolvedValue({
      id: 'other-channel',
      channelId: 'outlook',
      status: 'disconnected',
    });
    await expect(bindNangoMailbox(input, dependencies)).rejects.toMatchObject({
      code: 'MAILBOX_IDENTITY_MISMATCH',
    } satisfies Partial<NangoBindingError>);
  });

  it('rejects a Nango connection already bound elsewhere', async () => {
    const { repository, dependencies } = createDependencies();
    vi.mocked(repository.findByNangoReference).mockResolvedValue({ connectionId: 'other-mailbox' });

    await expect(bindNangoMailbox(input, dependencies)).rejects.toMatchObject({
      code: 'NANGO_CONNECTION_ALREADY_BOUND',
    } satisfies Partial<NangoBindingError>);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('does not persist anything when identity verification fails', async () => {
    const { channel, repository, dependencies } = createDependencies();
    vi.mocked(channel.resolveIdentity).mockRejectedValue(new Error('Gmail rejected token'));

    await expect(bindNangoMailbox(input, dependencies)).rejects.toMatchObject({
      code: 'NANGO_CONNECTION_INVALID',
    } satisfies Partial<NangoBindingError>);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('stores an encrypted snapshot without a Nango refresh token', async () => {
    const { repository, dependencies } = createDependencies();

    await bindNangoMailbox(input, dependencies);

    const saved = vi.mocked(repository.save).mock.calls[0]?.[0];
    const encrypted = saved?.authorization.encryptedCredentialSnapshot;
    expect(encrypted).not.toContain('nango-access-token');
    expect(encrypted).not.toContain('must-not-store');
    await expect(decryptCredential(encrypted!, encryptionKey)).resolves.toEqual({
      type: 'oauth2',
      accessToken: 'nango-access-token',
      scope: '',
    });
  });
});

describe('safe Nango connection summaries', () => {
  it('returns safe connection summaries without credentials', async () => {
    const client = {
      listConnections: vi.fn().mockResolvedValue([
        {
          ...connection,
          credentials: { access_token: 'must-not-leak' },
          tags: { end_user_email: 'owner@example.com' },
        },
      ]),
    } as unknown as NangoClient;

    const result = await listSafeNangoConnections('gmail-primary', client, vi.fn());

    expect(result).toEqual([
      {
        connectionId: 'nango-1',
        integrationId: 'gmail-primary',
        email: 'owner@example.com',
        displayName: 'owner@example.com',
        authorizationStatus: 'valid',
      },
    ]);
    expect(result[0]).not.toHaveProperty('credentials');
  });

  it('resolves a missing display email without exposing credentials', async () => {
    const client = {
      listConnections: vi.fn().mockResolvedValue([connection]),
    } as unknown as NangoClient;
    const resolveIdentity = vi.fn().mockResolvedValue({
      email: 'resolved@example.com',
      displayName: 'Resolved Owner',
    });

    const result = await listSafeNangoConnections('gmail-primary', client, resolveIdentity);

    expect(resolveIdentity).toHaveBeenCalledWith('nango-1');
    expect(result[0]).toEqual({
      connectionId: 'nango-1',
      integrationId: 'gmail-primary',
      email: 'resolved@example.com',
      displayName: 'Resolved Owner',
      authorizationStatus: 'valid',
    });
  });
});
