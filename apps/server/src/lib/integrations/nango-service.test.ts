import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SaveActiveIntegrationInput,
  SystemIntegrationRecord,
  SystemIntegrationRepository,
} from './repository';
import { NangoIntegrationError, NangoIntegrationService } from './nango-service';
import { encryptCredential } from '../credentials/encryption';
import type { NangoClient } from '../nango/client';

const encryptionKey = Buffer.alloc(32, 9).toString('base64');
const now = new Date('2026-07-24T08:00:00.000Z');

const integration = {
  unique_key: 'gmail-production',
  display_name: 'Gmail Production',
  provider: 'google-mail',
};

const connectionSummary = {
  connection_id: 'nango-connection-1',
  provider_config_key: 'gmail-production',
  provider: 'google-mail',
  metadata: null,
  tags: {},
  errors: [],
};

const credentialConnection = {
  ...connectionSummary,
  credentials: {
    type: 'OAUTH2' as const,
    access_token: 'access-token',
    raw: {},
  },
};

const createRepository = () => {
  let current: SystemIntegrationRecord | null = null;
  let mapping: Awaited<ReturnType<SystemIntegrationRepository['getMapping']>> = null;
  let references: Array<{ integrationId: string; connectionId: string }> = [];
  const saveActive = vi.fn(async (input: SaveActiveIntegrationInput) => {
    current = {
      id: 'integration-record-1',
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
  const repository: SystemIntegrationRepository = {
    get: vi.fn(async () => current),
    saveActive,
    delete: vi.fn(async () => {
      current = null;
    }),
    deleteNangoConfiguration: vi.fn(async () => {
      current = null;
      mapping = null;
    }),
    getMapping: vi.fn(async () => mapping),
    setMapping: vi.fn(async (channelId, authSource, integrationId) => {
      mapping = {
        id: 'mapping-1',
        channelId,
        authSource,
        externalIntegrationId: integrationId,
        createdAt: now,
        updatedAt: now,
      };
    }),
    deleteMapping: vi.fn(async () => {
      mapping = null;
    }),
    countNangoBindings: vi.fn(async (providerConfigKey) =>
      providerConfigKey
        ? references.filter(({ integrationId }) => integrationId === providerConfigKey).length
        : references.length,
    ),
    countZeroOAuthBindings: vi.fn(async () => 0),
    listNangoReferences: vi.fn(async () => references),
    createOAuthSession: vi.fn(),
    consumeOAuthSession: vi.fn(),
    deleteOAuthSession: vi.fn(),
    deleteExpiredOAuthSessions: vi.fn(),
  };
  return {
    repository,
    saveActive,
    setCurrent(value: SystemIntegrationRecord | null) {
      current = value;
    },
    setMapping(value: typeof mapping) {
      mapping = value;
    },
    setReferences(value: typeof references) {
      references = value;
    },
  };
};

const createClient = () =>
  ({
    listIntegrations: vi.fn().mockResolvedValue([integration]),
    listConnections: vi.fn().mockResolvedValue([connectionSummary]),
    getConnection: vi.fn().mockResolvedValue(credentialConnection),
  }) satisfies Pick<NangoClient, 'listIntegrations' | 'listConnections' | 'getConnection'>;

describe('Nango integration service', () => {
  let state: ReturnType<typeof createRepository>;

  beforeEach(() => {
    state = createRepository();
  });

  it('keeps the old configuration when permission validation fails', async () => {
    const encryptedSecret = await encryptCredential({ secretKey: 'old-secret' }, encryptionKey);
    state.setCurrent({
      id: 'integration-record-1',
      integrationKey: 'nango',
      publicConfig: { baseUrl: 'https://api.nango.dev' },
      encryptedSecret,
      status: 'active',
      validatedAt: now,
      updatedBy: 'admin-1',
      createdAt: now,
      updatedAt: now,
    });
    const client = createClient();
    client.listIntegrations.mockRejectedValue(new Error('forbidden'));
    const service = new NangoIntegrationService({
      repository: state.repository,
      encryptionKey,
      createClient: () => client,
      now: () => now,
    });

    await expect(
      service.validateAndSave({
        baseUrl: 'https://api.nango.dev',
        secretKey: 'replacement-secret',
        updatedBy: 'admin-1',
      }),
    ).rejects.toEqual(new NangoIntegrationError('NANGO_PERMISSION_VALIDATION_FAILED'));
    expect(state.saveActive).not.toHaveBeenCalled();
  });

  it('requires a credential-readable connection before the first save', async () => {
    const client = createClient();
    client.listConnections.mockResolvedValue([]);
    const service = new NangoIntegrationService({
      repository: state.repository,
      encryptionKey,
      createClient: () => client,
      now: () => now,
    });

    await expect(
      service.validateAndSave({
        baseUrl: 'https://api.nango.dev',
        secretKey: 'secret',
        updatedBy: 'admin-1',
      }),
    ).rejects.toEqual(new NangoIntegrationError('NANGO_TEST_CONNECTION_REQUIRED'));
  });

  it('forbids changing the Base URL while Nango bindings exist', async () => {
    const encryptedSecret = await encryptCredential({ secretKey: 'old-secret' }, encryptionKey);
    state.setCurrent({
      id: 'integration-record-1',
      integrationKey: 'nango',
      publicConfig: { baseUrl: 'https://api.nango.dev' },
      encryptedSecret,
      status: 'active',
      validatedAt: now,
      updatedBy: 'admin-1',
      createdAt: now,
      updatedAt: now,
    });
    state.setReferences([{ integrationId: 'gmail-production', connectionId: 'connection-1' }]);
    const service = new NangoIntegrationService({
      repository: state.repository,
      encryptionKey,
      createClient,
      now: () => now,
    });

    await expect(
      service.validateAndSave({
        baseUrl: 'https://different-nango.example.com',
        secretKey: 'replacement-secret',
        updatedBy: 'admin-1',
      }),
    ).rejects.toEqual(new NangoIntegrationError('INTEGRATION_IN_USE'));
  });

  it('validates every bound reference before rotating the Secret', async () => {
    const encryptedSecret = await encryptCredential({ secretKey: 'old-secret' }, encryptionKey);
    state.setCurrent({
      id: 'integration-record-1',
      integrationKey: 'nango',
      publicConfig: { baseUrl: 'https://api.nango.dev' },
      encryptedSecret,
      status: 'active',
      validatedAt: now,
      updatedBy: 'admin-1',
      createdAt: now,
      updatedAt: now,
    });
    state.setReferences([
      { integrationId: 'gmail-production', connectionId: 'connection-1' },
      { integrationId: 'gmail-production', connectionId: 'connection-2' },
    ]);
    const client = createClient();
    const service = new NangoIntegrationService({
      repository: state.repository,
      encryptionKey,
      createClient: () => client,
      now: () => now,
    });

    await service.validateAndSave({
      baseUrl: 'https://api.nango.dev',
      secretKey: 'replacement-secret',
      updatedBy: 'admin-1',
    });

    expect(client.getConnection).toHaveBeenCalledTimes(2);
    expect(state.saveActive).toHaveBeenCalledOnce();
  });

  it('forbids changing an occupied Gmail mapping', async () => {
    state.setMapping({
      id: 'mapping-1',
      channelId: 'gmail',
      authSource: 'nango',
      externalIntegrationId: 'gmail-production',
      createdAt: now,
      updatedAt: now,
    });
    state.setReferences([{ integrationId: 'gmail-production', connectionId: 'connection-1' }]);
    const service = new NangoIntegrationService({
      repository: state.repository,
      encryptionKey,
      createClient,
      now: () => now,
    });

    await expect(service.setGmailMapping('gmail-replacement')).rejects.toEqual(
      new NangoIntegrationError('INTEGRATION_IN_USE'),
    );
  });

  it('forbids deleting Nango while bindings exist', async () => {
    state.setReferences([{ integrationId: 'gmail-production', connectionId: 'connection-1' }]);
    const service = new NangoIntegrationService({
      repository: state.repository,
      encryptionKey,
      createClient,
      now: () => now,
    });

    await expect(service.delete()).rejects.toEqual(new NangoIntegrationError('INTEGRATION_IN_USE'));
    expect(state.repository.delete).not.toHaveBeenCalled();
  });
});
