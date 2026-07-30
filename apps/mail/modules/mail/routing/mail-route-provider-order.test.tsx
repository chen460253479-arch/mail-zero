import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';

const routeState = vi.hoisted(() => ({ pathname: '/mail/inbox' }));

const account = {
  id: 'account-a',
  connectionId: 'connection-a',
  status: 'active' as const,
  timezone: 'UTC',
  state: '1',
  storageQuotaBytes: null,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
};

vi.mock('@/modules/mail/queries/use-mail-account', async () => {
  const { MailAccountProvider } = await import('../providers/mail-account-provider');

  return {
    MailAccountBootstrapProvider({ children }: PropsWithChildren) {
      return (
        <MailAccountProvider
          accounts={[account]}
          activeConnectionId="connection-a"
          isLoading={false}
        >
          {children}
        </MailAccountProvider>
      );
    },
  };
});

vi.mock('@/components/context/command-palette-context', async () => {
  const { useMailAccountContext } = await import('../providers/mail-account-provider');

  return {
    CommandPaletteProvider({ children }: PropsWithChildren) {
      const { status } = useMailAccountContext();
      return <section data-mail-account-status={status}>{children}</section>;
    },
  };
});

vi.mock('@/components/providers/hotkey-provider-wrapper', () => ({
  HotkeyProviderWrapper: ({ children }: PropsWithChildren) => children,
}));

vi.mock('@/providers/query-provider', () => ({
  QueryProvider({ cacheSubject, children }: PropsWithChildren<{ cacheSubject: string | null }>) {
    return <div data-cache-subject={cacheSubject}>{children}</div>;
  },
}));

vi.mock('@/providers/user-theme-sync', () => ({
  UserThemeSync: () => null,
}));

vi.mock('react-router', () => ({
  Outlet: () => <main>mail route</main>,
  useLoaderData: () => ({ userId: 'user-1' }),
  useLocation: () => routeState,
}));

import MailRouteLayout from '../../../app/(routes)/layout';

describe('mail route provider order', () => {
  it('makes the active mail account available to the command palette', () => {
    routeState.pathname = '/mail/inbox';
    const html = renderToStaticMarkup(<MailRouteLayout />);

    expect(html).toContain('data-mail-account-status="ready"');
    expect(html).toContain('data-cache-subject="user:user-1"');
    expect(html).toContain('mail route');
  });

  it('does not start theme or mail account queries before the initial password is changed', () => {
    routeState.pathname = '/change-password';
    const html = renderToStaticMarkup(<MailRouteLayout />);

    expect(html).not.toContain('data-mail-account-status');
    expect(html).toContain('data-cache-subject="user:user-1"');
    expect(html).toContain('mail route');
  });
});
