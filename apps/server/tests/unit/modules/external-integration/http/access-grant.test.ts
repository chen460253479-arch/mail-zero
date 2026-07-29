import { describe, expect, it, vi } from 'vitest';

import { createExternalIntegrationRouter } from '../../../../../src/modules/external-integration/http/router';
import type { RuntimeServices } from '../../../../../src/runtime/node/services';

const createRouter = () => {
  const createAccessGrant = vi.fn(async () => ({
    launchCode: 'one-time-code',
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
  return {
    createAccessGrant,
    app: createExternalIntegrationRouter(services, {
      ensurePrincipal: vi.fn(async () => ({
        userId: 'zero-external-integration' as const,
      })),
      createAccessGrant,
    }),
  };
};

const requestGrant = async (
  app: ReturnType<typeof createExternalIntegrationRouter>,
  body: Record<string, unknown>,
  token = 'fixed-token',
) =>
  await app.request('/access-grants', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

describe('external access grant HTTP contract', () => {
  it('accepts only allowedNangoConnectIds and returns only launchCode', async () => {
    const { app, createAccessGrant } = createRouter();

    const response = await requestGrant(app, {
      allowedNangoConnectIds: ['connect-gmail-1', 'connect-outlook-1'],
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      launchCode: 'one-time-code',
    });
    expect(createAccessGrant).toHaveBeenCalledWith(
      {
        allowedNangoConnectIds: ['connect-gmail-1', 'connect-outlook-1'],
      },
      {
        userId: 'zero-external-integration',
      },
      expect.anything(),
    );
  });

  it('rejects additional identity and navigation fields', async () => {
    const { app, createAccessGrant } = createRouter();

    const response = await requestGrant(app, {
      allowedNangoConnectIds: ['connect-gmail-1'],
      returnUrl: 'https://crm.example.test/customer/1',
    });

    expect(response.status).toBe(400);
    expect(createAccessGrant).not.toHaveBeenCalled();
  });

  it('requires the fixed integration token', async () => {
    const { app, createAccessGrant } = createRouter();

    const response = await requestGrant(
      app,
      {
        allowedNangoConnectIds: ['connect-gmail-1'],
      },
      'wrong-token',
    );

    expect(response.status).toBe(401);
    expect(createAccessGrant).not.toHaveBeenCalled();
  });
});
