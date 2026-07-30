import { HotkeyProviderWrapper } from '@/components/providers/hotkey-provider-wrapper';
import { MailAccountBootstrapProvider } from '@/modules/mail/queries/use-mail-account';
import { CommandPaletteProvider } from '@/components/context/command-palette-context';
import { requiresInitialPasswordChange } from '@/modules/auth/login-method';
import { authProxy } from '@/lib/auth-proxy';
import type { Route } from './+types/layout';

import { Outlet, redirect } from 'react-router';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const session = await authProxy.api.getSession({ headers: request.headers });
  if (!session) throw redirect('/login');
  if (requiresInitialPasswordChange(session)) {
    throw redirect('/change-password');
  }
  return null;
}

export default function Layout() {
  return (
    <MailAccountBootstrapProvider>
      <CommandPaletteProvider>
        <HotkeyProviderWrapper>
          <div className="relative flex max-h-screen w-full overflow-hidden">
            <Outlet />
          </div>
        </HotkeyProviderWrapper>
      </CommandPaletteProvider>
    </MailAccountBootstrapProvider>
  );
}
