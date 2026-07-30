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

  it('returns an administrator user ID without requiring a password change', async () => {
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
    ).resolves.toEqual({
      userId: 'user-1',
      passwordChangeRequired: false,
    });
  });

  it('returns the password change requirement for a managed password Session', async () => {
    await expect(
      loadProtectedRouteSession(new Request('http://localhost:3000/mail/inbox'), {
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
    ).resolves.toEqual({
      userId: 'user-1',
      passwordChangeRequired: true,
    });
  });

  it('does not require a password change for a Launch Session', async () => {
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
    ).resolves.toEqual({
      userId: 'user-1',
      passwordChangeRequired: false,
    });
  });

  it('does not register a standalone password change route', () => {
    const protectedLayout = (routes as TestRoute[]).find(
      (route) => route.file === '(routes)/layout.tsx',
    );

    expect(protectedLayout?.children).not.toEqual(
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
