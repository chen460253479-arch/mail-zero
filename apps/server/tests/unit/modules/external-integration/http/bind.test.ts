import { describe, expect, it, vi } from 'vitest';

import { createExternalIntegrationRouter } from '../../../../../src/modules/external-integration/http/router';
import type { RuntimeServices } from '../../../../../src/runtime/node/services';

const createRouter = () => {
  const connect = vi.fn(async () => ({ id: 'zero-connection-1' }));
  const services = {
    config: {
      externalIntegration: {
        apiToken: 'fixed-token',
        webhook: {
          enabled: false,
        },
      },
    },
    database: {
      db: {},
    },
  } as RuntimeServices;
  const app = createExternalIntegrationRouter(services, {
    ensurePrincipal: vi.fn(async () => ({
      userId: 'zero-external-integration' as const,
    })),
    connect,
  });
  return { app, connect };
};

const requestBind = async (
  app: ReturnType<typeof createExternalIntegrationRouter>,
  input: {
    token?: string;
    sessionCookie?: string;
    body: Record<string, unknown>;
  },
) =>
  await app.request('/nango/connections/bind', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(input.token === undefined ? {} : { authorization: `Bearer ${input.token}` }),
      ...(input.sessionCookie === undefined ? {} : { cookie: input.sessionCookie }),
    },
    body: JSON.stringify(input.body),
  });

describe('external Nango connection binding HTTP contract', () => {
  it('accepts only channelId and connectionId', async () => {
    const { app, connect } = createRouter();

    const response = await requestBind(app, {
      token: 'fixed-token',
      body: {
        channelId: 'gmail',
        connectionId: 'connect-gmail-1',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'zero-connection-1',
    });
    expect(connect).toHaveBeenCalledWith(
      {
        userId: 'zero-external-integration',
        channelId: 'gmail',
        connectionId: 'connect-gmail-1',
      },
      expect.anything(),
    );
  });

  it('rejects additional external identity fields', async () => {
    const { app, connect } = createRouter();

    const response = await requestBind(app, {
      token: 'fixed-token',
      body: {
        channelId: 'gmail',
        connectionId: 'connect-gmail-1',
        externalUserId: 'not-accepted',
      },
    });

    expect(response.status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it('does not accept a browser session in place of the fixed token', async () => {
    const { app, connect } = createRouter();

    const response = await requestBind(app, {
      sessionCookie: 'better-auth.session_token=user-session',
      body: {
        channelId: 'gmail',
        connectionId: 'connect-gmail-1',
      },
    });

    expect(response.status).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });
});
