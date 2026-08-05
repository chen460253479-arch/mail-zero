import { describe, expect, it, vi } from 'vitest';

import { createExternalIntegrationRouter } from '../../../../../src/modules/external-integration/http/router';
import type { RuntimeServices } from '../../../../../src/runtime/node/services';

const createRouter = () => {
  const connect = vi.fn(async () => ({ id: 'zero-connection-1' }));
  const provisionManagedUser = vi.fn(async () => ({
    userId: 'managed-user-1',
    created: true,
  }));
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
    provisionManagedUser,
    connect,
  });
  return { app, connect, provisionManagedUser };
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
  it('keeps channels without custom data on the base binding contract', async () => {
    const { app, connect, provisionManagedUser } = createRouter();

    const response = await requestBind(app, {
      token: 'fixed-token',
      body: {
        externalUserId: 'user_200',
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
        userId: 'managed-user-1',
        channelId: 'gmail',
        connectionId: 'connect-gmail-1',
      },
      expect.anything(),
    );
    expect(provisionManagedUser).toHaveBeenCalledWith(
      { externalUserId: 'user_200' },
      expect.anything(),
    );
  });

  it('passes strict Zoho account and folder selection to mailbox binding', async () => {
    const { app, connect, provisionManagedUser } = createRouter();
    const externalData = {
      accountId: '2560636000000008002',
      folderIds: ['2560636000000012001'],
    };

    const response = await requestBind(app, {
      token: 'fixed-token',
      body: {
        externalUserId: 'crm-user-01',
        channelId: 'zoho_mail',
        connectionId: 'nango-connection-01',
        externalData,
      },
    });

    expect(response.status).toBe(200);
    expect(connect).toHaveBeenCalledWith(
      {
        userId: 'managed-user-1',
        channelId: 'zoho_mail',
        connectionId: 'nango-connection-01',
        externalData,
      },
      expect.anything(),
    );
    expect(provisionManagedUser).toHaveBeenCalledOnce();
  });

  it('accepts an account-only first Zoho configuration stage', async () => {
    const { app, connect } = createRouter();
    const externalData = { accountId: '2560636000000008002' };

    const response = await requestBind(app, {
      token: 'fixed-token',
      body: {
        externalUserId: 'crm-user-01',
        channelId: 'zoho_mail',
        connectionId: 'nango-connection-01',
        externalData,
      },
    });

    expect(response.status).toBe(200);
    expect(connect).toHaveBeenCalledWith(
      {
        userId: 'managed-user-1',
        channelId: 'zoho_mail',
        connectionId: 'nango-connection-01',
        externalData,
      },
      expect.anything(),
    );
  });

  it.each([
    undefined,
    { accountId: '1', folderIds: [] },
    { accountId: '1', folderIds: ['2'], version: 1 },
  ])('rejects missing, invalid, or extended Zoho externalData', async (externalData) => {
    const { app, connect, provisionManagedUser } = createRouter();

    const response = await requestBind(app, {
      token: 'fixed-token',
      body: {
        externalUserId: 'crm-user-01',
        channelId: 'zoho_mail',
        connectionId: 'nango-connection-01',
        ...(externalData === undefined ? {} : { externalData }),
      },
    });

    expect(response.status).toBe(400);
    expect(provisionManagedUser).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('rejects Zoho-specific externalData on other channels', async () => {
    const { app, connect, provisionManagedUser } = createRouter();

    const response = await requestBind(app, {
      token: 'fixed-token',
      body: {
        externalUserId: 'user_200',
        channelId: 'gmail',
        connectionId: 'connect-gmail-1',
        externalData: { accountId: '1', folderIds: ['2'] },
      },
    });

    expect(response.status).toBe(400);
    expect(provisionManagedUser).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('rejects an unrequested top-level version field', async () => {
    const { app, connect, provisionManagedUser } = createRouter();

    const response = await requestBind(app, {
      token: 'fixed-token',
      body: {
        externalUserId: 'crm-user-01',
        channelId: 'zoho_mail',
        connectionId: 'nango-connection-01',
        externalData: { accountId: '1', folderIds: ['2'] },
        version: 1,
      },
    });

    expect(response.status).toBe(400);
    expect(provisionManagedUser).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('requires externalUserId', async () => {
    const { app, connect, provisionManagedUser } = createRouter();

    const response = await requestBind(app, {
      token: 'fixed-token',
      body: {
        channelId: 'gmail',
        connectionId: 'connect-gmail-1',
      },
    });

    expect(response.status).toBe(400);
    expect(provisionManagedUser).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('does not accept a browser session in place of the fixed token', async () => {
    const { app, connect } = createRouter();

    const response = await requestBind(app, {
      sessionCookie: 'better-auth.session_token=user-session',
      body: {
        externalUserId: 'user_200',
        channelId: 'gmail',
        connectionId: 'connect-gmail-1',
      },
    });

    expect(response.status).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });
});
