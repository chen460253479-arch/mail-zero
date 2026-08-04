import { describe, expect, it, vi } from 'vitest';

import { createExternalIntegrationRouter } from '../../../../../src/modules/external-integration/http/router';
import type { RuntimeServices } from '../../../../../src/runtime/node/services';

const createRouter = () => {
  const disconnectNango = vi.fn(async () => ({
    id: 'zero-connection-1',
    status: 'disconnected' as const,
  }));
  const services = {
    config: {
      externalIntegration: {
        apiToken: 'fixed-token',
        webhook: { enabled: false },
      },
    },
    database: { db: {} },
  } as RuntimeServices;
  const app = createExternalIntegrationRouter(services, { disconnectNango });
  return { app, disconnectNango };
};

const requestDisconnect = async (
  app: ReturnType<typeof createExternalIntegrationRouter>,
  input: { token?: string; body: Record<string, unknown> },
) =>
  await app.request('/nango/connections/disconnect', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(input.token === undefined ? {} : { authorization: `Bearer ${input.token}` }),
    },
    body: JSON.stringify(input.body),
  });

describe('external Nango connection disconnect HTTP contract', () => {
  it('defaults to retaining local mailbox data', async () => {
    const { app, disconnectNango } = createRouter();

    const response = await requestDisconnect(app, {
      token: 'fixed-token',
      body: {
        externalUserId: 'user_200',
        channelId: 'gmail',
        connectionId: 'nango-connection-1',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'zero-connection-1',
      status: 'disconnected',
    });
    expect(disconnectNango).toHaveBeenCalledWith(
      {
        externalUserId: 'user_200',
        channelId: 'gmail',
        connectionId: 'nango-connection-1',
      },
      expect.anything(),
    );
  });

  it('rejects local data deletion controls from the caller', async () => {
    const { app, disconnectNango } = createRouter();

    const response = await requestDisconnect(app, {
      token: 'fixed-token',
      body: {
        externalUserId: 'user_200',
        channelId: 'gmail',
        connectionId: 'nango-connection-1',
        deleteLocalData: true,
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_REQUEST' });
    expect(disconnectNango).not.toHaveBeenCalled();
  });

  it('requires the fixed integration token', async () => {
    const { app, disconnectNango } = createRouter();

    const response = await requestDisconnect(app, {
      body: {
        externalUserId: 'user_200',
        channelId: 'gmail',
        connectionId: 'nango-connection-1',
      },
    });

    expect(response.status).toBe(401);
    expect(disconnectNango).not.toHaveBeenCalled();
  });

  it('rejects unknown request fields', async () => {
    const { app, disconnectNango } = createRouter();

    const response = await requestDisconnect(app, {
      token: 'fixed-token',
      body: {
        externalUserId: 'user_200',
        channelId: 'gmail',
        connectionId: 'nango-connection-1',
        unexpected: true,
      },
    });

    expect(response.status).toBe(400);
    expect(disconnectNango).not.toHaveBeenCalled();
  });
});
