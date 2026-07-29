import { describe, expect, it, vi } from 'vitest';

vi.mock('better-auth', () => ({
  APIError: class extends Error {},
  betterAuth: (options: unknown) => options,
}));

vi.mock('better-auth/plugins', () => ({
  bearer: () => ({ id: 'bearer' }),
  createAuthMiddleware: (handler: unknown) => handler,
  jwt: () => ({ id: 'jwt' }),
}));

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: () => ({ id: 'postgres-adapter' }),
}));

import { createSimpleAuth } from '../../../src/lib/auth';

describe('authentication session persistence', () => {
  it('keeps PostgreSQL as the source of truth for authenticated users', () => {
    const options = createSimpleAuth({
      db: {} as never,
      config: {
        nodeEnv: 'development',
        cookieDomain: 'localhost',
        publicAppUrl: 'http://localhost:3000',
        publicBackendUrl: 'http://localhost:8787',
        betterAuthTrustedOrigins: ['http://localhost:3000'],
      } as never,
      mail: {} as never,
      userWorkspace: {} as never,
      email: { send: vi.fn() },
    }) as unknown as {
      secondaryStorage?: unknown;
      session?: {
        cookieCache?: {
          enabled?: boolean;
        };
      };
    };

    expect(options.secondaryStorage).toBeUndefined();
    expect(options.session?.cookieCache?.enabled).toBe(false);
  });
});
