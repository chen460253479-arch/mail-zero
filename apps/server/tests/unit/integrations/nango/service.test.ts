import { describe, expect, it, vi } from 'vitest';

import {
  NangoIntegrationService,
  type NangoRuntimeErrorCode,
} from '../../../../src/integrations/nango/service';
import { NangoClientError, type NangoClient } from '../../../../src/integrations/nango/client';

const checkedAt = new Date('2026-07-28T08:00:00.000Z');

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

const createClient = () =>
  ({
    validateAccess: vi.fn().mockResolvedValue([integration]),
    listIntegrations: vi.fn().mockResolvedValue([integration]),
    listConnections: vi.fn().mockResolvedValue([connectionSummary]),
    getConnection: vi.fn().mockResolvedValue(credentialConnection),
  }) satisfies Pick<
    NangoClient,
    'validateAccess' | 'listIntegrations' | 'listConnections' | 'getConnection'
  >;

const createService = (
  input: {
    baseUrl?: string;
    secretKey?: string;
  },
  client = createClient(),
) => {
  const logError = vi.fn();
  const createClientMock = vi.fn(() => client);
  const service = new NangoIntegrationService({
    ...input,
    createClient: createClientMock,
    now: () => checkedAt,
    logError,
  });
  return { client, createClient: createClientMock, logError, service };
};

describe('Nango environment runtime service', () => {
  it('keeps an empty environment unconfigured without contacting Nango', async () => {
    const { createClient, logError, service } = createService({});

    await expect(service.initialize()).resolves.toEqual({
      state: 'unconfigured',
      checkedAt: null,
      errorCode: null,
    });
    expect(service.getStatus()).toEqual({
      state: 'unconfigured',
      checkedAt: null,
      errorCode: null,
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it.each([
    [{ baseUrl: 'https://api.nango.dev' }, 'NANGO_ENV_INCOMPLETE'],
    [{ secretKey: 'nango-secret' }, 'NANGO_ENV_INCOMPLETE'],
    [{ baseUrl: 'file:///tmp/nango', secretKey: 'nango-secret' }, 'NANGO_ENV_INVALID'],
    [{ baseUrl: 'not-a-url', secretKey: 'nango-secret' }, 'NANGO_ENV_INVALID'],
  ] satisfies Array<
    [
      { baseUrl?: string; secretKey?: string },
      Extract<NangoRuntimeErrorCode, 'NANGO_ENV_INCOMPLETE' | 'NANGO_ENV_INVALID'>,
    ]
  >)('marks invalid environment input unavailable: %o', async (input, errorCode) => {
    const { createClient, logError, service } = createService(input);

    await expect(service.initialize()).resolves.toEqual({
      state: 'unavailable',
      checkedAt,
      errorCode,
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(errorCode, {
      operation: null,
      status: null,
    });
  });

  it('shares one validation promise across concurrent startup events', async () => {
    let releaseValidation: ((integrations: (typeof integration)[]) => void) | undefined;
    const client = createClient();
    client.validateAccess.mockImplementation(
      () =>
        new Promise<(typeof integration)[]>((resolve) => {
          releaseValidation = resolve;
        }),
    );
    const { createClient: createClientMock, service } = createService(
      {
        baseUrl: 'https://api.nango.dev/',
        secretKey: ' nango-secret ',
      },
      client,
    );

    const first = service.initialize();
    const second = service.initialize();

    expect(first).toBe(second);
    expect(service.getStatus()).toEqual({
      state: 'validating',
      checkedAt: null,
      errorCode: null,
    });
    expect(createClientMock).toHaveBeenCalledOnce();
    expect(createClientMock).toHaveBeenCalledWith({
      baseUrl: 'https://api.nango.dev',
      secretKey: 'nango-secret',
    });
    expect(client.validateAccess).toHaveBeenCalledOnce();

    releaseValidation?.([integration]);

    await expect(first).resolves.toEqual({
      state: 'available',
      checkedAt,
      errorCode: null,
    });
  });

  it.each([
    ['INVALID_API_KEY', 401, 'list_integrations', 'NANGO_API_KEY_INVALID'],
    ['INSUFFICIENT_PERMISSIONS', 403, 'list_connections', 'NANGO_INSUFFICIENT_PERMISSIONS'],
    ['ENDPOINT_NOT_FOUND', 404, 'list_integrations', 'NANGO_ENDPOINT_NOT_FOUND'],
    ['INVALID_RESPONSE', 200, 'list_connections', 'NANGO_INVALID_RESPONSE'],
    ['REQUEST_FAILED', null, 'list_integrations', 'NANGO_UNREACHABLE'],
    ['REQUEST_FAILED', 500, 'list_integrations', 'NANGO_REQUEST_FAILED'],
  ] as const)(
    'records safe startup status for %s',
    async (clientCode, status, operation, errorCode) => {
      const client = createClient();
      client.validateAccess.mockRejectedValue(new NangoClientError(clientCode, status, operation));
      const { logError, service } = createService(
        {
          baseUrl: 'https://api.nango.dev',
          secretKey: 'super-sensitive-key',
        },
        client,
      );

      await expect(service.initialize()).resolves.toEqual({
        state: 'unavailable',
        checkedAt,
        errorCode,
      });
      expect(logError).toHaveBeenCalledWith(errorCode, { operation, status });
      expect(JSON.stringify(service.getStatus())).not.toContain('super-sensitive-key');
      expect(JSON.stringify(logError.mock.calls)).not.toContain('super-sensitive-key');
    },
  );

  it('does not expose unknown upstream errors in runtime state or logs', async () => {
    const client = createClient();
    client.validateAccess.mockRejectedValue(new Error('upstream leaked sensitive response'));
    const { logError, service } = createService(
      {
        baseUrl: 'https://api.nango.dev',
        secretKey: 'super-sensitive-key',
      },
      client,
    );

    await expect(service.initialize()).resolves.toEqual({
      state: 'unavailable',
      checkedAt,
      errorCode: 'NANGO_REQUEST_FAILED',
    });
    expect(logError).toHaveBeenCalledWith('NANGO_REQUEST_FAILED', {
      operation: null,
      status: null,
    });
    expect(JSON.stringify(logError.mock.calls)).not.toContain('upstream leaked sensitive response');
  });

  it('contains client construction failures without blocking Server startup', async () => {
    const logError = vi.fn();
    const service = new NangoIntegrationService({
      baseUrl: 'https://api.nango.dev',
      secretKey: 'super-sensitive-key',
      createClient: () => {
        throw new Error('client construction leaked sensitive response');
      },
      now: () => checkedAt,
      logError,
    });

    await expect(service.initialize()).resolves.toEqual({
      state: 'unavailable',
      checkedAt,
      errorCode: 'NANGO_REQUEST_FAILED',
    });
    expect(logError).toHaveBeenCalledWith('NANGO_REQUEST_FAILED', {
      operation: null,
      status: null,
    });
    expect(JSON.stringify(logError.mock.calls)).not.toContain('client construction');
  });

  it('rejects runtime operations unless startup validation is available', async () => {
    const { service } = createService({});

    await expect(service.listIntegrations()).rejects.toMatchObject({
      code: 'NANGO_NOT_CONFIGURED',
    });
  });

  it('uses the validated client for runtime operations', async () => {
    const { client, service } = createService({
      baseUrl: 'https://api.nango.dev',
      secretKey: 'nango-secret',
    });

    await service.initialize();

    await expect(service.listIntegrations()).resolves.toEqual([integration]);
    await expect(service.listConnections('gmail-production')).resolves.toEqual([connectionSummary]);
    await expect(service.getConnection('nango-connection-1', 'gmail-production')).resolves.toEqual(
      credentialConnection,
    );
    expect(client.validateAccess).toHaveBeenCalledOnce();
    expect(client.listIntegrations).not.toHaveBeenCalled();
  });
});
