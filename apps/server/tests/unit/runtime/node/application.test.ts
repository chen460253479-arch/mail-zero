import { describe, expect, it, vi } from 'vitest';

import { createNodeApplication } from '../../../../src/runtime/node/application';
import type { RuntimeServices } from '../../../../src/runtime/node/services';

const createServices = (
  readiness: Partial<RuntimeServices['readiness']['snapshot']> = {},
): RuntimeServices =>
  ({
    config: {
      nodeEnv: 'local',
      publicAppUrl: 'http://mail.local:3000',
      cookieDomain: 'mail.local',
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

  it('keeps provider webhooks registered against injected runtime services', async () => {
    const services = createServices();
    const app = createNodeApplication(services);

    const gmail = await app.request('/api/mail/channels/gmail/push', { method: 'POST' });
    const outlook = await app.request('/api/webhooks/mail/outlook', { method: 'POST' });
    const zoho = await app.request('/api/webhooks/mail/zoho/token-1', { method: 'POST' });

    expect([gmail.status, outlook.status, zoho.status]).toEqual([202, 202, 202]);
    expect(services.webhooks.gmail).toHaveBeenCalledOnce();
    expect(services.webhooks.outlook).toHaveBeenCalledOnce();
    expect(services.webhooks.zohoMail).toHaveBeenCalledWith(expect.any(Request), 'token-1');
  });

  it('resolves the external cookie without creating a session user', async () => {
    const services = createServices();
    const resolveExternalSession = vi.fn(async () => ({
      id: 'external-session-1',
      ownerUserId: 'zero-external-integration' as const,
      scopes: [
        {
          nangoConnectionId: 'connect-1',
          connectionId: 'connection-1',
          mailAccountId: 'account-1',
        },
      ],
      activeConnectionId: 'connection-1',
      expiresAt: new Date('2026-08-20T00:00:00.000Z'),
      updatedAt: new Date('2026-07-29T00:00:00.000Z'),
    }));
    const app = createNodeApplication(services, {
      resolveExternalSession,
    });

    const response = await app.request('/api/trpc/externalAccess.current', {
      headers: {
        cookie: 'zero-external-session=raw-session-token',
      },
    });

    expect(resolveExternalSession).toHaveBeenCalledWith('raw-session-token', services);
    expect(response.headers.get('set-cookie')).toContain('zero-external-session=raw-session-token');
  });

  it('gives a real Better Auth session priority over the external cookie', async () => {
    const services = createServices();
    services.auth.api.getSession = vi.fn(async () => ({
      user: { id: 'real-user' },
    })) as never;
    const resolveExternalSession = vi.fn();
    const app = createNodeApplication(services, {
      resolveExternalSession,
    });

    await app.request('/api/trpc/externalAccess.current', {
      headers: {
        cookie: 'zero-external-session=raw-session-token',
      },
    });

    expect(resolveExternalSession).not.toHaveBeenCalled();
  });
});
