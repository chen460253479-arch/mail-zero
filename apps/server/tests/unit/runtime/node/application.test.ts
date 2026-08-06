import { describe, expect, it, vi } from 'vitest';

const mailApiRuntimeMocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  openAccessible: vi.fn(),
}));

vi.mock('../../../../src/modules/mail-api/runtime/create-mail-api', async (importOriginal) => ({
  ...(await importOriginal()),
  openAccessibleMailApiRuntime: mailApiRuntimeMocks.openAccessible,
}));

import { createNodeApplication } from '../../../../src/runtime/node/application';
import type { RuntimeServices } from '../../../../src/runtime/node/services';

const createServices = (
  readiness: Partial<RuntimeServices['readiness']['snapshot']> = {},
  config: Partial<RuntimeServices['config']> = {},
): RuntimeServices =>
  ({
    config: {
      nodeEnv: 'local',
      publicAppUrl: 'http://mail.local:3000',
      cookieDomain: 'mail.local',
      ...config,
    },
    logger: {
      level: 'debug',
      child: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    database: {
      db: {},
    },
    readiness: {
      snapshot: {
        database: true,
        blobStore: true,
        worker: true,
        scheduler: true,
        http: true,
        ...readiness,
      },
    },
    integrationHealth: {
      getStatus: vi.fn(() => ({
        state: 'unavailable',
        checkedAt: new Date('2026-07-29T00:00:00.000Z'),
        errorCode: 'NANGO_UNREACHABLE',
      })),
    },
    ensureAdmin: vi.fn(async () => undefined),
    auth: {
      api: {
        getSession: vi.fn(async () => null),
      },
    },
    webhooks: {
      gmail: vi.fn(async () => new Response(null, { status: 202 })),
      outlook: vi.fn(async () => new Response(null, { status: 202 })),
      zohoMail: vi.fn(async () => new Response(null, { status: 202 })),
    },
  }) as unknown as RuntimeServices;

describe('native Node application', () => {
  it('reports healthy only after every core runtime component is ready', async () => {
    const healthy = createNodeApplication(createServices());
    const starting = createNodeApplication(createServices({ worker: false }));

    expect((await healthy.request('/health')).status).toBe(200);
    expect((await starting.request('/health')).status).toBe(503);
  });

  it('does not make Nango availability part of core health', async () => {
    const services = createServices();
    const app = createNodeApplication(services);

    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(services.integrationHealth.getStatus()).toMatchObject({
      state: 'unavailable',
    });
  });

  it('redirects the root route to the independent frontend', async () => {
    const app = createNodeApplication(createServices());

    const response = await app.request('/');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://mail.local:3000');
  });

  it('allows a localhost subdomain when COOKIE_DOMAIN has a leading dot', async () => {
    const origin = 'http://mail.localhost:3000';
    const app = createNodeApplication(
      createServices(
        {},
        {
          publicAppUrl: origin,
          cookieDomain: '.localhost',
        },
      ),
    );

    const response = await app.request('/health', {
      headers: { origin },
    });

    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('keeps provider webhooks registered against injected runtime services', async () => {
    const services = createServices();
    const app = createNodeApplication(services);

    const gmail = await app.request('/api/mail/channels/gmail/push', { method: 'POST' });
    const outlook = await app.request('/api/webhooks/mail/outlook', { method: 'POST' });
    const zoho = await app.request('/api/webhooks/mail/zoho', { method: 'POST' });

    expect([gmail.status, outlook.status, zoho.status]).toEqual([202, 202, 202]);
    expect(services.webhooks.gmail).toHaveBeenCalledOnce();
    expect(services.webhooks.outlook).toHaveBeenCalledOnce();
    expect(services.webhooks.zohoMail).toHaveBeenCalledWith(
      expect.any(Request),
      expect.any(String),
    );
  });

  it('logs request metadata without query parameters or authorization values', async () => {
    const services = createServices();
    const app = createNodeApplication(services);

    const response = await app.request('/health?access_token=private', {
      headers: {
        authorization: 'Bearer private',
        'x-request-id': 'crm-request-1',
        'x-trace-id': 'crm-trace-1',
      },
    });

    expect(response.headers.get('x-request-id')).toBe('crm-request-1');
    expect(response.headers.get('x-trace-id')).toBe('crm-trace-1');
    expect(services.logger.debug).toHaveBeenCalledWith('http.request_completed', {
      requestId: 'crm-request-1',
      traceId: 'crm-trace-1',
      method: 'GET',
      path: '/health',
      status: 200,
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(vi.mocked(services.logger.debug).mock.calls)).not.toContain('private');
  });

  it('routes mail blob HTTP requests without passing them to the tRPC handler', async () => {
    const services = createServices();
    services.auth.api.getSession = vi.fn(async () => ({
      user: { id: 'user-1' },
      session: { id: 'session-1', userId: 'user-1' },
    })) as never;
    mailApiRuntimeMocks.openAccessible.mockResolvedValue({
      core: {
        getBlob: vi.fn(async () => ({ contentType: 'message/rfc822' })),
        readBlob: vi.fn(async () => new Uint8Array([1, 2, 3])),
      },
      close: mailApiRuntimeMocks.close,
    });
    const app = createNodeApplication(services);

    const response = await app.request('/api/mail/accounts/account-1/blobs/blob-1/message.eml');

    expect(response.status).toBe(200);
    expect(await response.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
    expect(mailApiRuntimeMocks.openAccessible).toHaveBeenCalledWith(
      {
        accountId: 'account-1',
        actorUserId: 'user-1',
        isAdministrator: false,
      },
      services,
    );
    expect(mailApiRuntimeMocks.close).toHaveBeenCalledOnce();
  });

  it('blocks an initial-password Session before a private procedure runs', async () => {
    const services = createServices();
    services.auth.api.getSession = vi.fn(async () => ({
      user: {
        id: 'managed-user-1',
        role: 'user',
        mustChangePassword: true,
      },
      session: {
        id: 'session-1',
        userId: 'managed-user-1',
        authMethod: 'password',
      },
    })) as never;
    const deleteUser = vi.fn();
    services.auth.api.deleteUser = deleteUser as never;
    const app = createNodeApplication(services);

    const response = await app.request('/api/trpc/user.delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: null }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain('PASSWORD_CHANGE_REQUIRED');
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('does not allow the administrator account to be deleted', async () => {
    const services = createServices();
    services.auth.api.getSession = vi.fn(async () => ({
      user: {
        id: 'admin-1',
        role: 'admin',
        mustChangePassword: false,
      },
      session: {
        id: 'session-1',
        userId: 'admin-1',
        authMethod: 'password',
      },
    })) as never;
    const deleteUser = vi.fn();
    services.auth.api.deleteUser = deleteUser as never;
    const app = createNodeApplication(services);

    const response = await app.request('/api/trpc/user.delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: null }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain('ADMIN_ACCOUNT_CANNOT_BE_DELETED');
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('lets a Launch Session use the same private procedures', async () => {
    const services = createServices();
    services.auth.api.getSession = vi.fn(async () => ({
      user: {
        id: 'managed-user-1',
        role: 'user',
        mustChangePassword: true,
      },
      session: {
        id: 'session-1',
        userId: 'managed-user-1',
        authMethod: 'launch',
      },
    })) as never;
    const deleteUser = vi.fn(async () => ({ success: true, message: 'ok' }));
    services.auth.api.deleteUser = deleteUser as never;
    const app = createNodeApplication(services);

    const response = await app.request('/api/trpc/user.delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: null }),
    });

    expect(response.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledOnce();
  });
});
