import { describe, expect, it, vi } from 'vitest';

import { loadProtectedRouteSession } from '../auth/protected-route-session';
import routes from '../../app/routes';

type TestRoute = {
  file?: string;
  path?: string;
  children?: TestRoute[];
};

describe('protected route Session boundary', () => {
  it('redirects an anonymous request to login', async () => {
    const response = await loadProtectedRouteSession(
      new Request('http://localhost:3000/mail/inbox'),
      {
        getSession: vi.fn(async () => null),
      },
    ).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.get('Location')).toBe('/login');
  });

  it('returns the authenticated user ID for user-scoped providers', async () => {
    await expect(
      loadProtectedRouteSession(new Request('http://localhost:3000/mail/inbox'), {
        getSession: vi.fn(async () => ({
          user: {
            id: 'user-1',
            role: 'admin',
            mustChangePassword: false,
          },
          session: {
            authMethod: 'password',
          },
        })),
      }),
    ).resolves.toEqual({ userId: 'user-1' });
  });

  it('requires a password-authenticated managed user to change the initial password', async () => {
    const response = await loadProtectedRouteSession(
      new Request('http://localhost:3000/mail/inbox'),
      {
        getSession: vi.fn(async () => ({
          user: {
            id: 'user-1',
            role: 'user',
            mustChangePassword: true,
          },
          session: {
            authMethod: 'password',
          },
        })),
      },
    ).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.get('Location')).toBe('/change-password');
  });

  it('lets that managed user render the password change page through the same Session boundary', async () => {
    await expect(
      loadProtectedRouteSession(new Request('http://localhost:3000/change-password'), {
        getSession: vi.fn(async () => ({
          user: {
            id: 'user-1',
            role: 'user',
            mustChangePassword: true,
          },
          session: {
            authMethod: 'password',
          },
        })),
      }),
    ).resolves.toEqual({ userId: 'user-1' });
  });

  it('lets a Launch Session use the same protected route without a second access mode', async () => {
    await expect(
      loadProtectedRouteSession(new Request('http://localhost:3000/mail/inbox'), {
        getSession: vi.fn(async () => ({
          user: {
            id: 'user-1',
            role: 'user',
            mustChangePassword: true,
          },
          session: {
            authMethod: 'launch',
          },
        })),
      }),
    ).resolves.toEqual({ userId: 'user-1' });
  });

  it('registers the password change page beneath the protected route layout', () => {
    const protectedLayout = (routes as TestRoute[]).find(
      (route) => route.file === '(routes)/layout.tsx',
    );

    expect(protectedLayout?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: '(auth)/change-password/page.tsx',
          path: '/change-password',
        }),
      ]),
    );
  });

  it('does not keep a second authentication loader at the application root', async () => {
    const rootRoute = (await import('../../app/root')) as Record<string, unknown>;

    expect(rootRoute.loader).toBeUndefined();
    expect(rootRoute.clientLoader).toBeUndefined();
  }, 15_000);
});
