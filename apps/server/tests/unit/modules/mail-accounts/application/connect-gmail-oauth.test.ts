import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CreateOAuthSessionInput,
  OAuthSessionRecord,
  SaveActiveIntegrationInput,
  SystemIntegrationRecord,
  SystemIntegrationRepository,
} from '../../../../../src/integrations/core/repository';
import {
  GmailOAuthError,
  GmailOAuthService,
  type GmailOAuthGateway,
  type GmailOAuthMailboxRepository,
} from '../../../../../src/modules/mail-accounts/application/connect-gmail-oauth';
import {
  decryptCredential,
  encryptCredential,
} from '../../../../../src/infrastructure/security/credential-encryption';

const encryptionKey = Buffer.alloc(32, 7).toString('base64');
const now = new Date('2026-07-24T10:00:00.000Z');
const redirectUris = {
  validation: 'https://api.example.com/api/integrations/gmail/validation/callback',
  mailbox: 'https://api.example.com/api/integrations/gmail/connect/callback',
};

const createRepository = () => {
  let current: SystemIntegrationRecord | null = null;
  const sessions = new Map<string, OAuthSessionRecord>();
  const saveActive = vi.fn(async (input: SaveActiveIntegrationInput) => {
    current = {
      id: 'gmail-config-1',
      integrationKey: input.integrationKey,
      publicConfig: input.publicConfig,
      encryptedSecret: input.encryptedSecret,
      status: 'active',
      validatedAt: input.validatedAt,
      updatedBy: input.updatedBy,
      createdAt: now,
      updatedAt: now,
    };
  });
  const createOAuthSession = vi.fn(async (input: CreateOAuthSessionInput) => {
    const id = `session-${sessions.size + 1}`;
    sessions.set(id, { id, consumedAt: null, ...input });
    return id;
  });
  const repository: SystemIntegrationRepository = {
    get: vi.fn(async () => current),
    saveActive,
    delete: vi.fn(async () => {
      current = null;
    }),
    deleteNangoConfiguration: vi.fn(),
    getMapping: vi.fn(async () => null),
    setMapping: vi.fn(),
    deleteMapping: vi.fn(),
    countBindings: vi.fn(async () => 0),
    countNangoBindings: vi.fn(async () => 0),
    countZeroOAuthBindings: vi.fn(async () => 0),
    listNangoReferences: vi.fn(async () => []),
    createOAuthSession,
    getOAuthSession: vi.fn(async ({ id, createdBy, purpose }) => {
      const session = sessions.get(id);
      return session && session.createdBy === createdBy && session.purpose === purpose
        ? session
        : null;
    }),
    consumeOAuthSession: vi.fn(async ({ stateHash, createdBy, purpose, now: consumedAt }) => {
      const session = [...sessions.values()].find(
        (candidate) =>
          candidate.stateHash === stateHash &&
          candidate.createdBy === createdBy &&
          candidate.purpose === purpose &&
          !candidate.consumedAt &&
          candidate.expiresAt > consumedAt,
      );
      if (!session) return null;
      const consumed = { ...session, consumedAt };
      sessions.set(session.id, consumed);
      return consumed;
    }),
    deleteOAuthSession: vi.fn(async (id) => {
      sessions.delete(id);
    }),
    deleteExpiredOAuthSessions: vi.fn(),
  };
  return {
    repository,
    saveActive,
    createOAuthSession,
    setCurrent(value: SystemIntegrationRecord | null) {
      current = value;
    },
  };
};

const createGateway = () =>
  ({
    createAuthorizationUrl: vi.fn(({ state }) => `https://accounts.google.test?state=${state}`),
    exchangeCode: vi.fn(async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date('2026-07-24T11:00:00.000Z'),
      scope: 'gmail',
    })),
    resolveIdentity: vi.fn(async () => ({
      email: 'Owner@Example.com',
      name: 'Owner',
      picture: 'https://example.com/owner.png',
    })),
    revokeToken: vi.fn(async () => undefined),
  }) satisfies GmailOAuthGateway;

const createMailboxRepository = () => {
  const save = vi.fn<GmailOAuthMailboxRepository['save']>(async () => ({ id: 'mailbox-1' }));
  return { save };
};

const getState = (authorizationUrl: string): string => {
  const state = new URL(authorizationUrl).searchParams.get('state');
  if (!state) throw new Error('Missing test state');
  return state;
};

describe('Gmail OAuth integration service', () => {
  let state: ReturnType<typeof createRepository>;
  let gateway: ReturnType<typeof createGateway>;
  let mailboxRepository: ReturnType<typeof createMailboxRepository>;

  beforeEach(() => {
    state = createRepository();
    gateway = createGateway();
    mailboxRepository = createMailboxRepository();
  });

  const createService = () =>
    new GmailOAuthService({
      repository: state.repository,
      mailboxRepository,
      gateway,
      encryptionKey,
      redirectUris,
      now: () => now,
    });

  it('stores only a state hash and encrypted candidate payload', async () => {
    const result = await createService().startValidation({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      adminId: 'admin-1',
    });
    const stateValue = getState(result.authorizationUrl);
    const session = state.createOAuthSession.mock.calls[0]?.[0];

    expect(session?.stateHash).not.toBe(stateValue);
    expect(session?.encryptedPayload).not.toContain('client-secret');
    await expect(decryptCredential(session!.encryptedPayload, encryptionKey)).resolves.toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: redirectUris.validation,
    });
  });

  it('rejects a callback that does not belong to its initiating administrator', async () => {
    const started = await createService().startValidation({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      adminId: 'admin-1',
    });

    await expect(
      createService().completeValidation({
        state: getState(started.authorizationUrl),
        code: 'authorization-code',
        adminId: 'admin-2',
      }),
    ).rejects.toEqual(new GmailOAuthError('GMAIL_OAUTH_SESSION_INVALID'));
    expect(gateway.exchangeCode).not.toHaveBeenCalled();
  });

  it('promotes the candidate only after Gmail identity succeeds and revokes test tokens', async () => {
    const service = createService();
    const started = await service.startValidation({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      adminId: 'admin-1',
    });

    await service.completeValidation({
      state: getState(started.authorizationUrl),
      code: 'authorization-code',
      adminId: 'admin-1',
    });

    expect(gateway.resolveIdentity).toHaveBeenCalledOnce();
    expect(gateway.revokeToken).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-id' }),
      'access-token',
    );
    expect(state.saveActive).toHaveBeenCalledOnce();
    expect(mailboxRepository.save).not.toHaveBeenCalled();
  });

  it('keeps the active configuration when candidate validation fails', async () => {
    const encryptedSecret = await encryptCredential({ clientSecret: 'old-secret' }, encryptionKey);
    state.setCurrent({
      id: 'gmail-config-1',
      integrationKey: 'gmail_zero_oauth',
      publicConfig: { clientId: 'old-client-id' },
      encryptedSecret,
      status: 'active',
      validatedAt: now,
      updatedBy: 'admin-1',
      createdAt: now,
      updatedAt: now,
    });
    gateway.resolveIdentity.mockRejectedValue(new Error('missing Gmail permission'));
    const service = createService();
    const started = await service.startValidation({
      clientId: 'replacement-client-id',
      clientSecret: 'replacement-secret',
      adminId: 'admin-1',
    });

    await expect(
      service.completeValidation({
        state: getState(started.authorizationUrl),
        code: 'authorization-code',
        adminId: 'admin-1',
      }),
    ).rejects.toEqual(new GmailOAuthError('GMAIL_OAUTH_VALIDATION_FAILED'));
    expect(state.saveActive).not.toHaveBeenCalled();
  });

  it('forbids replacing Gmail OAuth configuration while mailbox bindings exist', async () => {
    state.repository.countZeroOAuthBindings = vi.fn(async () => 1);

    await expect(
      createService().startValidation({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        adminId: 'admin-1',
      }),
    ).rejects.toEqual(new GmailOAuthError('INTEGRATION_IN_USE'));
  });

  it('creates a zero_oauth binding only after authoritative Gmail identity resolution', async () => {
    const encryptedSecret = await encryptCredential(
      { clientSecret: 'client-secret' },
      encryptionKey,
    );
    state.setCurrent({
      id: 'gmail-config-1',
      integrationKey: 'gmail_zero_oauth',
      publicConfig: { clientId: 'client-id' },
      encryptedSecret,
      status: 'active',
      validatedAt: now,
      updatedBy: 'admin-1',
      createdAt: now,
      updatedAt: now,
    });
    const service = createService();
    const started = await service.startMailboxAuthorization('user-1');

    await service.completeMailboxAuthorization({
      state: getState(started.authorizationUrl),
      code: 'authorization-code',
      userId: 'user-1',
    });

    expect(gateway.resolveIdentity).toHaveBeenCalledOnce();
    expect(mailboxRepository.save).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        email: 'Owner@Example.com',
        channelId: 'gmail',
        providerKey: 'gmail',
      }),
      expect.objectContaining({
        authSource: 'zero_oauth',
        credentialType: 'oauth2',
      }),
    );
    const authorization = mailboxRepository.save.mock.calls[0]?.[2];
    await expect(
      decryptCredential(authorization!.encryptedCredentialSnapshot!, encryptionKey),
    ).resolves.toEqual({
      type: 'oauth2',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      scope: 'gmail',
    });
  });
});
