import { describe, expect, it, vi } from 'vitest';

import { createExternalIntegrationRouter } from '../../../../../src/modules/external-integration/http/router';
import type { RuntimeServices } from '../../../../../src/runtime/node/services';

const createRouter = () => {
  const consumeManagedLaunch = vi.fn(
    async () =>
      new Response(null, {
        status: 303,
        headers: {
          location: 'https://mail.zero.example.test/mail/inbox',
          'set-cookie':
            'better-auth.session_token=standard-session-token.signed; HttpOnly; Path=/; SameSite=Lax',
        },
      }),
  );
  const services = {
    config: {
      publicAppUrl: 'https://mail.zero.example.test',
      externalIntegration: {
        apiToken: 'fixed-token',
        webhook: { enabled: false },
      },
    },
    database: { db: {} },
  } as RuntimeServices;
  return {
    consumeManagedLaunch,
    app: createExternalIntegrationRouter(services, {
      consumeManagedLaunch,
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
  it('delegates to Better Auth and returns its standard Session response', async () => {
    const { app, consumeManagedLaunch } = createRouter();

    const response = await launch(app, new URLSearchParams({ launchCode: 'one-time-code' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://mail.zero.example.test/mail/inbox');
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('better-auth.session_token=standard-session-token.signed');
    expect(cookie).not.toContain('zero-external-session');
    expect(cookie).not.toContain('one-time-code');
    expect(consumeManagedLaunch).toHaveBeenCalledWith(
      { launchCode: 'one-time-code' },
      expect.anything(),
    );
  });

  it('rejects returnUrl before calling Better Auth', async () => {
    const { app, consumeManagedLaunch } = createRouter();

    const response = await launch(
      app,
      new URLSearchParams({
        launchCode: 'one-time-code',
        returnUrl: 'https://attacker.example.test',
      }),
    );

    expect(response.status).toBe(400);
    expect(consumeManagedLaunch).not.toHaveBeenCalled();
  });
});
