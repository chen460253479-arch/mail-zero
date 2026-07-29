import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CreateOAuthSessionInput,
  OAuthSessionRecord,
  SaveActiveIntegrationInput,
  SystemIntegrationRecord,
  SystemIntegrationRepository,
} from '../../../../../src/integrations/core/repository';
import {
  ChannelOAuthService,
  type ChannelOAuthMailboxRepository,
} from '../../../../../src/modules/mail-accounts/application/connect-channel-oauth';
import { decryptCredential } from '../../../../../src/infrastructure/security/credential-encryption';
import type { MailOAuthGateway } from '../../../../../src/mail-channel/oauth/types';

const encryptionKey = Buffer.alloc(32, 11).toString('base64');
const now = new Date('2026-07-28T12:00:00.000Z');
const redirectUris = {
  validation: 'https://mail.example.test/api/integrations/outlook/validation/callback',
  mailbox: 'https://mail.example.test/api/integrations/outlook/connect/callback',
};

const createRepository = () => {
  let current: SystemIntegrationRecord | null = null;
  const sessions = new Map<string, OAuthSessionRecord>();
  const repository: SystemIntegrationRepository = {
    get: vi.fn(async () => current),
    saveActive: vi.fn(async (input: SaveActiveIntegrationInput) => {
      current = {
        id: 'outlook-config',
        ...input,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
    }),
    delete: vi.fn(async () => {
      current = null;
    }),
    countBindings: vi.fn(async () => 0),
    countNangoBindings: vi.fn(async () => 0),
    countZeroOAuthBindings: vi.fn(async () => 0),
    createOAuthSession: vi.fn(async (input: CreateOAuthSessionInput) => {
      const id = `session-${sessions.size + 1}`;
      sessions.set(id, { id, consumedAt: null, ...input });
      return id;
    }),
    getOAuthSession: vi.fn(async ({ id, integrationKey, createdBy, purpose }) => {
      const session = sessions.get(id);
      return session !== undefined &&
        session.integrationKey === integrationKey &&
        session.createdBy === createdBy &&
        session.purpose === purpose
        ? session
        : null;
    }),
    consumeOAuthSession: vi.fn(
      async ({ stateHash, integrationKey, createdBy, purpose, now: consumedAt }) => {
        const session = [...sessions.values()].find(
          (candidate) =>
            candidate.stateHash === stateHash &&
            candidate.integrationKey === integrationKey &&
            candidate.createdBy === createdBy &&
            candidate.purpose === purpose &&
            candidate.consumedAt === null &&
            candidate.expiresAt > consumedAt,
        );
        if (!session) return null;
        const consumed = { ...session, consumedAt };
        sessions.set(session.id, consumed);
        return consumed;
      },
    ),
    deleteOAuthSession: vi.fn(async (id) => {
      sessions.delete(id);
    }),
    deleteExpiredOAuthSessions: vi.fn(),
  };
  return repository;
};

const createGateway = () =>
  ({
    createAuthorizationUrl: vi.fn(({ state }) => `https://login.test/?state=${state}`),
    exchangeCode: vi.fn(async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date('2026-07-28T13:00:00.000Z'),
      scope: 'Mail.Read Mail.Send',
    })),
    refreshTokens: vi.fn(),
    resolveIdentity: vi.fn(async () => ({
      email: 'owner@example.com',
      name: 'Owner',
      picture: '',
    })),
    revokeToken: vi.fn(async () => undefined),
  }) satisfies MailOAuthGateway;

const getState = (authorizationUrl: string): string => {
  const value = new URL(authorizationUrl).searchParams.get('state');
  if (!value) throw new Error('missing state');
  return value;
};

describe('shared Outlook/Zoho Zero OAuth service', () => {
  let repository: ReturnType<typeof createRepository>;
  let gateway: ReturnType<typeof createGateway>;
  let mailbox: { save: ReturnType<typeof vi.fn<ChannelOAuthMailboxRepository['save']>> };

  beforeEach(() => {
    repository = createRepository();
    gateway = createGateway();
    mailbox = {
      save: vi.fn<ChannelOAuthMailboxRepository['save']>(async () => ({
        id: 'connection-1',
      })),
    };
  });

  const service = () =>
    new ChannelOAuthService({
      spec: {
        channelId: 'outlook',
        providerKey: 'outlook',
        integrationKey: 'outlook_zero_oauth',
      },
      repository,
      mailboxRepository: mailbox,
      gateway,
      encryptionKey,
      redirectUris,
      loadProviderConfig: async () => ({ tenantId: 'common' }),
      now: () => now,
    });

  it('binds OAuth state to the selected provider and encrypts candidate secrets', async () => {
    const started = await service().startValidation({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      adminId: 'admin-1',
    });
    const session = vi.mocked(repository.createOAuthSession).mock.calls[0]![0];

    expect(session.integrationKey).toBe('outlook_zero_oauth');
    expect(session.stateHash).not.toBe(getState(started.authorizationUrl));
    await expect(decryptCredential(session.encryptedPayload, encryptionKey)).resolves.toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: redirectUris.validation,
      providerConfig: { tenantId: 'common' },
    });
  });

  it('persists a provider-neutral local mailbox after OAuth callback', async () => {
    const validation = await service().startValidation({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      adminId: 'admin-1',
    });
    await service().completeValidation({
      state: getState(validation.authorizationUrl),
      code: 'validation-code',
      adminId: 'admin-1',
    });
    const started = await service().startMailboxAuthorization('user-1');
    await service().completeMailboxAuthorization({
      state: getState(started.authorizationUrl),
      code: 'mailbox-code',
      userId: 'user-1',
    });

    expect(mailbox.save).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        channelId: 'outlook',
        providerKey: 'outlook',
        email: 'owner@example.com',
      }),
      expect.objectContaining({
        authSource: 'zero_oauth',
        credentialType: 'oauth2',
      }),
    );
  });
});
