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

vi.mock('../../../src/db', () => ({
  createDb: () => ({ db: {} }),
}));

vi.mock('../../../src/env', () => ({
  env: {
    COOKIE_DOMAIN: 'localhost',
    HYPERDRIVE: { connectionString: 'postgresql://localhost/zero' },
    NODE_ENV: 'development',
    VITE_PUBLIC_APP_URL: 'http://localhost:3000',
    VITE_PUBLIC_BACKEND_URL: 'http://localhost:8787',
  },
}));

vi.mock('../../../src/lib/services', () => ({
  redis: () => ({
    del: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  }),
  resend: () => ({ emails: { send: vi.fn() } }),
}));

vi.mock('../../../src/lib/server-utils', () => ({
  getUserWorkspace: vi.fn(),
}));

vi.mock('../../../src/modules/mail-accounts/runtime/lifecycle-environment', () => ({
  createMailboxLifecycleForDatabase: vi.fn(),
}));

import { createSimpleAuth } from '../../../src/lib/auth';

describe('authentication session persistence', () => {
  it('keeps PostgreSQL as the source of truth for authenticated users', () => {
    const options = createSimpleAuth() as unknown as {
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
