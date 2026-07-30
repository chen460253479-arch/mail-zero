import { describe, expect, it } from 'vitest';

import { createUserWorkspaceService } from '../../src/modules/user-workspace/service';
import type { MailInboundRuntimeResources } from '../../src/runtime/mail/inbound';
import { withMailTestDatabase } from '../helpers/mail-core/database';
import type { RuntimeConfig } from '../../src/runtime/node/config';
import { provisionAdmin } from '../../src/lib/admin-provisioning';
import { createAuth } from '../../src/lib/auth';

const createConfig = (input: {
  publicAppUrl: string;
  publicBackendUrl: string;
  cookieDomain: string;
}): RuntimeConfig =>
  ({
    nodeEnv: 'production',
    betterAuthSecret: 'local-cookie-test-secret-with-at-least-32-characters',
    betterAuthTrustedOrigins: [input.publicAppUrl],
    ...input,
  }) as RuntimeConfig;

const signInAdministrator = async (config: RuntimeConfig): Promise<Response> => {
  let response: Response | undefined;
  await withMailTestDatabase(async ({ db }) => {
    const userWorkspace = createUserWorkspaceService({ db });
    await provisionAdmin(
      {
        name: 'Administrator',
        email: 'admin@example.test',
        password: 'administrator-password',
      },
      { db, userWorkspace },
    );
    const auth = createAuth({
      db,
      config,
      mail: {} as MailInboundRuntimeResources,
      userWorkspace,
      email: { send: async () => undefined },
    });
    response = await auth.handler(
      new Request(`${config.publicBackendUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: config.publicAppUrl,
        },
        body: JSON.stringify({
          email: 'admin@example.test',
          password: 'administrator-password',
          rememberMe: true,
        }),
      }),
    );
  });
  return response!;
};

describe('authentication Cookie domain', () => {
  it.each([
    {
      label: 'localhost',
      publicAppUrl: 'http://localhost:3000',
      publicBackendUrl: 'http://localhost:8787',
      cookieDomain: 'localhost',
    },
    {
      label: 'localhost with a leading dot',
      publicAppUrl: 'http://mail.localhost:3000',
      publicBackendUrl: 'http://api.localhost:8787',
      cookieDomain: '.localhost',
    },
    {
      label: 'IPv4',
      publicAppUrl: 'http://127.0.0.1:3000',
      publicBackendUrl: 'http://127.0.0.1:8787',
      cookieDomain: '127.0.0.1',
    },
    {
      label: 'bracketed IPv6',
      publicAppUrl: 'http://[::1]:3000',
      publicBackendUrl: 'http://[::1]:8787',
      cookieDomain: '[::1]',
    },
  ])('uses a host-only Session Cookie for $label', async (input) => {
    const response = await signInAdministrator(
      createConfig({
        publicAppUrl: input.publicAppUrl,
        publicBackendUrl: input.publicBackendUrl,
        cookieDomain: input.cookieDomain,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=');
    expect(response.headers.get('set-cookie')).not.toMatch(/;\s*Domain=/iu);
  });

  it('keeps the configured Cookie domain for a real shared parent domain', async () => {
    const response = await signInAdministrator(
      createConfig({
        publicAppUrl: 'https://mail.zero.example.test',
        publicBackendUrl: 'https://api.zero.example.test',
        cookieDomain: 'zero.example.test',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Domain=zero.example.test');
  });
});
