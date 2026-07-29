import { describe, expect, it, vi } from 'vitest';

import { createExternalIntegrationRouter } from '../../../../../src/modules/external-integration/http/router';
import type { RuntimeServices } from '../../../../../src/runtime/node/services';

const createRouter = (nodeEnv: 'local' | 'production' = 'local') => {
  const consumeLaunchCode = vi.fn(async () => ({
    sessionToken: 'browser-session-token',
    session: {
      id: 'external-session-1',
      ownerUserId: 'zero-external-integration' as const,
      scopes: [
        {
          nangoConnectionId: 'connect-gmail-1',
          connectionId: 'connection-gmail-1',
          mailAccountId: 'account-gmail-1',
        },
      ],
      activeConnectionId: 'connection-gmail-1',
      updatedAt: new Date('2026-07-29T10:00:00.000Z'),
      expiresAt: new Date('2026-08-28T10:00:00.000Z'),
    },
  }));
  const services = {
    config: {
      nodeEnv,
      publicAppUrl: 'https://mail.zero.example.test',
      cookieDomain: 'zero.example.test',
      externalIntegration: {
        apiToken: 'fixed-token',
        webhook: { enabled: false },
      },
    },
    database: { db: {} },
  } as RuntimeServices;
  return {
    consumeLaunchCode,
    app: createExternalIntegrationRouter(services, {
      consumeLaunchCode,
    }),
  };
};

const launch = async (
  app: ReturnType<typeof createExternalIntegrationRouter>,
  body: URLSearchParams,
) =>
  await app.request('/launch', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

describe('external launch HTTP endpoint', () => {
  it('sets an HttpOnly session cookie and redirects to the mail homepage', async () => {
    const { app, consumeLaunchCode } = createRouter();

    const response = await launch(app, new URLSearchParams({ launchCode: 'one-time-code' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://mail.zero.example.test/mail/inbox');
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('zero-external-session=browser-session-token');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Domain=zero.example.test');
    expect(cookie).not.toContain('one-time-code');
    expect(consumeLaunchCode).toHaveBeenCalledWith(
      { launchCode: 'one-time-code' },
      expect.anything(),
    );
  });

  it('uses Secure cookies outside local development', async () => {
    const { app } = createRouter('production');

    const response = await launch(app, new URLSearchParams({ launchCode: 'one-time-code' }));

    expect(response.headers.get('set-cookie')).toContain('Secure');
  });

  it('rejects returnUrl and does not redirect to caller-controlled URLs', async () => {
    const { app, consumeLaunchCode } = createRouter();

    const response = await launch(
      app,
      new URLSearchParams({
        launchCode: 'one-time-code',
        returnUrl: 'https://attacker.example.test',
      }),
    );

    expect(response.status).toBe(400);
    expect(consumeLaunchCode).not.toHaveBeenCalled();
  });
});
