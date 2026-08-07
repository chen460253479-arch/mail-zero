import { describe, expect, it, vi } from 'vitest';

import { createExternalIntegrationRouter } from '../../../../../src/modules/external-integration/http/router';
import { ExternalIntegrationError } from '../../../../../src/modules/external-integration/errors';
import type { RuntimeServices } from '../../../../../src/runtime/node/services';

const createRouter = () => {
  const createAccessGrant = vi.fn(async () => ({
    launchCode: 'one-time-code',
  }));
  const provisionManagedUser = vi.fn(async () => ({
    userId: 'managed-user-1',
    created: true,
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
      provisionManagedUser,
    }),
    provisionManagedUser,
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
  it('auto-registers externalUserId and returns only launchCode', async () => {
    const { app, createAccessGrant, provisionManagedUser } = createRouter();

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
    expect(provisionManagedUser).toHaveBeenCalledWith(
      { externalUserId: 'user_200' },
      expect.anything(),
    );
  });

  it('rejects additional identity and navigation fields', async () => {
    const { app, createAccessGrant, provisionManagedUser } = createRouter();

    const response = await requestGrant(app, {
      externalUserId: 'user_200',
      returnUrl: 'https://crm.example.test/customer/1',
    });

    expect(response.status).toBe(400);
    expect(provisionManagedUser).not.toHaveBeenCalled();
    expect(createAccessGrant).not.toHaveBeenCalled();
  });

  it('rejects a collision with a non-user account', async () => {
    const { app, createAccessGrant, provisionManagedUser } = createRouter();
    provisionManagedUser.mockRejectedValueOnce(
      new ExternalIntegrationError('EXTERNAL_USER_INVALID'),
    );

    const response = await requestGrant(app, {
      externalUserId: 'admin_user',
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'EXTERNAL_USER_INVALID' });
    expect(createAccessGrant).not.toHaveBeenCalled();
  });

  it('requires the fixed integration token', async () => {
    const { app, createAccessGrant, provisionManagedUser } = createRouter();

    const response = await requestGrant(
      app,
      {
        externalUserId: 'user_200',
      },
      'wrong-token',
    );

    expect(response.status).toBe(401);
    expect(provisionManagedUser).not.toHaveBeenCalled();
    expect(createAccessGrant).not.toHaveBeenCalled();
  });
});
