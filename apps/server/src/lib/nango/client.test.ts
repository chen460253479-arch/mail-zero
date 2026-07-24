import { describe, expect, it, vi } from 'vitest';

import { NangoClient, NangoClientError } from './client';

const connectionSummary = {
  connection_id: 'mailbox-1',
  provider_config_key: 'gmail-primary',
  provider: 'google-mail',
  metadata: { email: 'owner@example.com' },
  tags: { end_user_email: 'owner@example.com' },
  errors: [],
};

const createClient = (fetchMock: typeof fetch) =>
  new NangoClient({
    baseUrl: 'https://api.nango.dev/',
    secretKey: 'nango-secret',
    fetch: fetchMock,
  });

describe('NangoClient', () => {
  it('sends the secret only in the Authorization header', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [{ unique_key: 'gmail-primary', display_name: 'Gmail', provider: 'google-mail' }],
      }),
    );

    await createClient(fetchMock).listIntegrations();

    expect(fetchMock).toHaveBeenCalledWith('https://api.nango.dev/integrations', {
      headers: { Authorization: 'Bearer nango-secret' },
    });
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('nango-secret');
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
      { headers: { Authorization: 'Bearer nango-secret' } },
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
    } satisfies Partial<NangoClientError>);
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
