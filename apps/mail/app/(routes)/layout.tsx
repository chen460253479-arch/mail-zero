import { PasswordChangeRequiredView } from '@/modules/auth/password-change-required-view';
import { HotkeyProviderWrapper } from '@/components/providers/hotkey-provider-wrapper';
import { MailAccountBootstrapProvider } from '@/modules/mail/queries/use-mail-account';
import { CommandPaletteProvider } from '@/components/context/command-palette-context';
import { loadProtectedRouteSession } from '@/modules/auth/protected-route-session';
import { UserThemeSync } from '@/providers/user-theme-sync';
import { QueryProvider } from '@/providers/query-provider';
import { authProxy } from '@/lib/auth-proxy';
import type { Route } from './+types/layout';

import { Outlet, useLoaderData } from 'react-router';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  return await loadProtectedRouteSession(request, {
    getSession: async ({ headers }) => await authProxy.api.getSession({ headers }),
  });
}

export default function Layout() {
  const { userId, passwordChangeRequired } = useLoaderData<typeof clientLoader>();

  return (
    <QueryProvider cacheSubject={`user:${userId}`}>
      {passwordChangeRequired ? (
        <PasswordChangeRequiredView />
      ) : (
        <>
          <UserThemeSync />
          <MailAccountBootstrapProvider>
            <CommandPaletteProvider>
              <HotkeyProviderWrapper>
                <div className="relative flex max-h-screen w-full overflow-hidden">
                  <Outlet />
                </div>
              </HotkeyProviderWrapper>
            </CommandPaletteProvider>
          </MailAccountBootstrapProvider>
        </>
      )}
    </QueryProvider>
  );
}
