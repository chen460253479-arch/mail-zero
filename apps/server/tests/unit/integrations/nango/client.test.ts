import { describe, expect, it, vi } from 'vitest';

import { NangoClient, NangoClientError } from '../../../../src/integrations/nango/client';

const connectionSummary = {
  connection_id: 'mailbox-1',
  provider_config_key: 'gmail-primary',
  provider: 'google-mail',
  metadata: { email: 'owner@example.com' },
  tags: { end_user_id: 'crm-user-1', end_user_email: 'owner@example.com' },
  errors: [],
};

const createClient = (fetchMock: typeof fetch) =>
  new NangoClient({
    baseUrl: 'https://api.nango.dev/',
    secretKey: 'nango-secret',
    fetch: fetchMock,
  });

describe('Nango client', () => {
  it('validates integrations and one bounded connections page', async () => {
    const integrations = [
      { unique_key: 'gmail-primary', display_name: 'Gmail', provider: 'google-mail' },
    ];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: integrations }))
      .mockResolvedValueOnce(Response.json({ connections: [] }));

    await expect(createClient(fetchMock).validateAccess()).resolves.toEqual(integrations);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.nango.dev/integrations');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.nango.dev/connections?limit=1&page=0');
  });

  it('applies a timeout signal to every Nango request', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }));

    await createClient(fetchMock).listIntegrations();

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends the secret only in the Authorization header', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [{ unique_key: 'gmail-primary', display_name: 'Gmail', provider: 'google-mail' }],
      }),
    );

    await createClient(fetchMock).listIntegrations();

    expect(fetchMock).toHaveBeenCalledWith('https://api.nango.dev/integrations', {
      headers: { Authorization: 'Bearer nango-secret' },
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('nango-secret');
  });

  it('does not rebind the injected Worker fetch receiver', async () => {
    const workerFetch = function (this: unknown): Promise<Response> {
      if (this !== undefined) {
        throw new TypeError('Illegal invocation: incorrect this reference');
      }
      return Promise.resolve(Response.json({ data: [] }));
    } as typeof fetch;

    await expect(createClient(workerFetch).listIntegrations()).resolves.toEqual([]);
  });

  it('lists connections without credential fields', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        connections: [{ ...connectionSummary, credentials: { access_token: 'must-not-leak' } }],
      }),
    );

    const connections = await createClient(fetchMock).listConnections('gmail-primary');

    expect(connections).toEqual([connectionSummary]);
    expect(connections[0]).not.toHaveProperty('credentials');
  });

  it('filters connection summaries by integration ID on the server', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        connections: [
          connectionSummary,
          { ...connectionSummary, connection_id: 'mailbox-2', provider_config_key: 'other' },
        ],
      }),
    );

    const connections = await createClient(fetchMock).listConnections('gmail-primary');

    expect(connections.map(({ connection_id }) => connection_id)).toEqual(['mailbox-1']);
  });

  it('lists all connection summaries when no integration filter is provided', async () => {
    const otherConnection = {
      ...connectionSummary,
      connection_id: 'mailbox-2',
      provider_config_key: 'outlook-primary',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ connections: [connectionSummary, otherConnection] }));

    const connections = await createClient(fetchMock).listConnections();

    expect(connections).toEqual([connectionSummary, otherConnection]);
  });

  it('starts connection pagination from Nango page zero', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ connections: [connectionSummary] }));

    await createClient(fetchMock).listConnections('gmail-primary');

    expect(fetchMock).toHaveBeenCalledWith('https://api.nango.dev/connections?limit=100&page=0', {
      headers: { Authorization: 'Bearer nango-secret' },
      signal: expect.any(AbortSignal),
    });
  });

  it('filters connections at Nango by end-user tag on every page', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...connectionSummary,
      connection_id: `mailbox-${index}`,
    }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ connections: firstPage }))
      .mockResolvedValueOnce(Response.json({ connections: [] }));

    await createClient(fetchMock).listConnections('gmail-primary', {
      end_user_id: 'crm/user 1',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.nango.dev/connections?limit=100&page=0&tags%5Bend_user_id%5D=crm%2Fuser+1',
      {
        headers: { Authorization: 'Bearer nango-secret' },
        signal: expect.any(AbortSignal),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.nango.dev/connections?limit=100&page=1&tags%5Bend_user_id%5D=crm%2Fuser+1',
      {
        headers: { Authorization: 'Bearer nango-secret' },
        signal: expect.any(AbortSignal),
      },
    );
  });

  it('finds integration connections beyond the first API page', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...connectionSummary,
      connection_id: `other-${index}`,
      provider_config_key: 'other',
    }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ connections: firstPage }))
      .mockResolvedValueOnce(Response.json({ connections: [connectionSummary] }));

    const connections = await createClient(fetchMock).listConnections('gmail-primary');

    expect(connections).toEqual([connectionSummary]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.nango.dev/connections?limit=100&page=1',
      {
        headers: { Authorization: 'Bearer nango-secret' },
        signal: expect.any(AbortSignal),
      },
    );
  });

  it('requires provider_config_key when reading one connection', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ...connectionSummary,
        credentials: {
          type: 'OAUTH2',
          access_token: 'access-token',
          expires_at: '2026-07-24T12:00:00.000Z',
          raw: {},
        },
      }),
    );

    await createClient(fetchMock).getConnection('mailbox/1', 'gmail primary');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.nango.dev/connections/mailbox%2F1?provider_config_key=gmail+primary',
      {
        headers: { Authorization: 'Bearer nango-secret' },
        signal: expect.any(AbortSignal),
      },
    );
  });

  it('maps 424 to an invalid-credentials error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('provider details', { status: 424 }));

    await expect(
      createClient(fetchMock).getConnection('mailbox-1', 'gmail-primary'),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      status: 424,
      operation: 'get_connection',
    } satisfies Partial<NangoClientError>);
  });

  it.each([
    [401, 'INVALID_API_KEY'],
    [403, 'INSUFFICIENT_PERMISSIONS'],
    [404, 'ENDPOINT_NOT_FOUND'],
    [500, 'REQUEST_FAILED'],
  ] as const)('maps HTTP %i without exposing the response body', async (status, code) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('sensitive upstream response', { status }));

    await expect(createClient(fetchMock).listIntegrations()).rejects.toMatchObject({
      code,
      status,
      operation: 'list_integrations',
      message: expect.not.stringContaining('sensitive upstream response'),
    });
  });

  it('identifies the failed operation when Nango is unreachable', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('socket failed'));

    await expect(createClient(fetchMock).listConnections('gmail-primary')).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      status: null,
      operation: 'list_connections',
      message: expect.not.stringContaining('socket failed'),
    });
  });

  it('identifies invalid connection responses without exposing credentials', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ credentials: { access_token: 'must-not-leak' } }));

    await expect(
      createClient(fetchMock).getConnection('mailbox-1', 'gmail-primary'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 200,
      operation: 'get_connection',
      message: expect.not.stringContaining('must-not-leak'),
    });
  });

  it('redacts the response body from thrown errors', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('sensitive upstream response', { status: 500 }));

    await expect(createClient(fetchMock).listIntegrations()).rejects.not.toThrow(
      /sensitive upstream response/,
    );
  });
});
