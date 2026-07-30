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
  it('accepts only externalUserId and returns only launchCode', async () => {
    const { app, createAccessGrant } = createRouter();

    const response = await requestGrant(app, {
      externalUserId: 'user_200',
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      launchCode: 'one-time-code',
    });
    expect(createAccessGrant).toHaveBeenCalledWith(
      {
        externalUserId: 'user_200',
      },
      expect.anything(),
    );
  });

  it('rejects additional identity and navigation fields', async () => {
    const { app, createAccessGrant } = createRouter();

    const response = await requestGrant(app, {
      externalUserId: 'user_200',
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
        externalUserId: 'user_200',
      },
      'wrong-token',
    );

    expect(response.status).toBe(401);
    expect(createAccessGrant).not.toHaveBeenCalled();
  });
});
